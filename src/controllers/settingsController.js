import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { AppError, asyncHandler, successResponse } from '../utils/apiResponse.js';
import { sanitizeUser, generateOtp } from '../utils/helpers.js';
import config from '../config/index.js';
import {
  User,
  LoginAttempt,
  AuthenticatorConfig,
} from '../models/index.js';
import UserSecuritySettings, { MFA_PREFERENCES } from '../models/UserSecuritySettings.js';
import { ROLES, ACTIVITY_ACTIONS, ENTITY_TYPES } from '../constants/index.js';
import { logActivity } from '../services/auditService.js';
import {
  listUserSessions,
  deleteSession,
  revokeOtherUserSessions,
} from '../services/redisService.js';
import { sendOtpEmail } from '../services/emailService.js';
import { getRedisClient, REDIS_KEYS } from '../config/redis.js';

import { encryptSecret, decryptSecret } from '../utils/encryption.js';
import { validatePasswordStrength, assertPasswordsMatch } from '../utils/password.js';

const getTotpSecret = (authConfig) => decryptSecret(authConfig?.secret);

const getOrCreateSecuritySettings = async (userId) => {
  let settings = await UserSecuritySettings.findOne({ user: userId });
  if (!settings) {
    settings = await UserSecuritySettings.create({ user: userId });
  }
  return settings;
};

const enforceSuperAdminMfaRules = (user, settings, updates) => {
  if (user.role !== ROLES.SUPER_ADMIN) return;

  const nextPreference = updates.mfaPreference ?? settings.mfaPreference;
  const emailEnabled = updates.emailOtpEnabled ?? settings.emailOtpEnabled;

  if (nextPreference === 'otp' && !emailEnabled) {
    throw new AppError('Super Admin must keep at least one MFA method enabled', 400, 'MFA_REQUIRED');
  }
};

export const getAccountSettings = asyncHandler(async (req, res) => {
  const [securitySettings, authConfig] = await Promise.all([
    getOrCreateSecuritySettings(req.user._id),
    AuthenticatorConfig.findOne({ user: req.user._id }),
  ]);

  successResponse(res, {
    profile: sanitizeUser(req.user),
    security: {
      emailOtpEnabled: securitySettings.emailOtpEnabled,
      mfaPreference: securitySettings.mfaPreference,
      totpEnabled: authConfig?.isEnabled || false,
      lastPasswordChangeAt: securitySettings.lastPasswordChangeAt,
      lastLoginAt: req.user.lastLoginAt,
      mfaOptions: MFA_PREFERENCES,
    },
    notifications: securitySettings.notifications || {
      email: true,
      followUp: true,
      assignment: true,
      security: true,
    },
  });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const { name, phone, avatar } = req.body;
  const user = await User.findById(req.user._id);

  if (name?.trim()) user.name = name.trim();
  if (phone !== undefined) user.phone = phone?.trim() || '';
  if (avatar !== undefined) user.avatar = avatar;

  await user.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.USER_UPDATE,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    updatedValues: { name, phone, avatar: avatar ? 'updated' : undefined },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, sanitizeUser(user), 'Profile updated');
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword) throw new AppError('New password is required', 400);

  validatePasswordStrength(newPassword);

  const user = await User.findById(req.user._id).select('+password');

  if (user.password) {
    if (!currentPassword) throw new AppError('Current password is required', 400);
    const valid = await user.comparePassword(currentPassword);
    if (!valid) throw new AppError('Current password is incorrect', 401);
  }

  user.password = newPassword;
  user.mustSetPasswordOnFirstLogin = false;
  user.mustChangePassword = false;
  user.passwordSetAt = new Date();
  await user.save();

  const settings = await getOrCreateSecuritySettings(user._id);
  settings.lastPasswordChangeAt = new Date();
  await settings.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.UPDATE,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    metadata: { action: 'password_change' },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, null, 'Password updated successfully');
});

export const requestEmailChange = asyncHandler(async (req, res) => {
  const { newEmail } = req.body;
  if (!newEmail) throw new AppError('New email is required', 400);

  const normalized = newEmail.toLowerCase().trim();
  const existing = await User.findOne({ email: normalized, _id: { $ne: req.user._id } });
  if (existing) throw new AppError('Email already in use', 409);

  const otp = generateOtp();
  const redis = getRedisClient();
  await redis.setex(
    REDIS_KEYS.emailChange(req.user._id.toString()),
    config.otp.expirySeconds,
    JSON.stringify({ newEmail: normalized, otp })
  );

  await sendOtpEmail(normalized, otp, req.user.name);

  successResponse(res, { expiresIn: config.otp.expirySeconds }, 'Verification code sent to new email');
});

export const verifyEmailChange = asyncHandler(async (req, res) => {
  const { otp } = req.body;
  const redis = getRedisClient();
  const raw = await redis.get(REDIS_KEYS.emailChange(req.user._id.toString()));
  if (!raw) throw new AppError('Email change request expired', 400);

  const { newEmail, otp: storedOtp } = JSON.parse(raw);
  if (storedOtp !== otp) throw new AppError('Invalid verification code', 401);

  const user = await User.findById(req.user._id);
  user.email = newEmail;
  await user.save();
  await redis.del(REDIS_KEYS.emailChange(req.user._id.toString()));

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.USER_UPDATE,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    metadata: { action: 'email_change' },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, sanitizeUser(user), 'Email updated successfully');
});

export const getAccountActivity = asyncHandler(async (req, res) => {
  const { limit = 50 } = req.query;
  const attempts = await LoginAttempt.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(Number(limit));

  successResponse(res, attempts);
});

export const getActiveSessions = asyncHandler(async (req, res) => {
  const sessions = await listUserSessions(req.user._id.toString(), req.sessionId);
  successResponse(res, sessions);
});

export const revokeSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  if (sessionId === req.sessionId) {
    throw new AppError('Cannot revoke current session. Use logout instead.', 400);
  }

  const sessions = await listUserSessions(req.user._id.toString(), req.sessionId);
  const target = sessions.find((s) => s.sessionId === sessionId);
  if (!target) throw new AppError('Session not found', 404);

  await deleteSession(sessionId);

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.LOGOUT,
    entityType: ENTITY_TYPES.USER,
    entityId: req.user._id,
    metadata: { action: 'remote_session_revoke', sessionId },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, null, 'Session terminated');
});

export const revokeAllOtherSessions = asyncHandler(async (req, res) => {
  const count = await revokeOtherUserSessions(req.user._id.toString(), req.sessionId);

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.LOGOUT,
    entityType: ENTITY_TYPES.USER,
    entityId: req.user._id,
    metadata: { action: 'revoke_all_other_sessions', count },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, { revokedCount: count }, 'Other sessions terminated');
});

export const getSecurityDashboard = asyncHandler(async (req, res) => {
  const [settings, authConfig, sessions] = await Promise.all([
    getOrCreateSecuritySettings(req.user._id),
    AuthenticatorConfig.findOne({ user: req.user._id }),
    listUserSessions(req.user._id.toString(), req.sessionId),
  ]);

  successResponse(res, {
    mfaPreference: settings.mfaPreference,
    emailOtpEnabled: settings.emailOtpEnabled,
    totpEnabled: authConfig?.isEnabled || false,
    lastPasswordChangeAt: settings.lastPasswordChangeAt,
    lastLoginAt: req.user.lastLoginAt,
    activeSessionCount: sessions.length,
    trustedDevices: settings.trustedDevices || [],
  });
});

export const setupTotp = asyncHandler(async (req, res) => {
  const secret = speakeasy.generateSecret({ name: `Corizo Desk (${req.user.email})` });
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

  await AuthenticatorConfig.findOneAndUpdate(
    { user: req.user._id },
    { secret: encryptSecret(secret.base32), isEnabled: false },
    { upsert: true }
  );

  successResponse(res, {
    qrCodeUrl,
    secret: secret.base32,
  }, 'Scan QR code with your authenticator app');
});

export const verifyTotpSetup = asyncHandler(async (req, res) => {
  const { totpCode } = req.body;
  const authConfig = await AuthenticatorConfig.findOne({ user: req.user._id }).select('+secret');
  if (!authConfig?.secret) throw new AppError('TOTP setup not initiated', 400);

  const verified = speakeasy.totp.verify({
    secret: getTotpSecret(authConfig),
    encoding: 'base32',
    token: totpCode,
    window: 1,
  });

  if (!verified) throw new AppError('Invalid TOTP code', 401);

  authConfig.isEnabled = true;
  authConfig.verifiedAt = new Date();
  await authConfig.save();

  if (req.user.role === ROLES.SUPER_ADMIN) {
    const settings = await getOrCreateSecuritySettings(req.user._id);
    if (settings.mfaPreference === 'otp') {
      settings.mfaPreference = 'both';
      await settings.save();
    }
  }

  successResponse(res, { totpEnabled: true }, 'Authenticator app enabled');
});

export const disableTotp = asyncHandler(async (req, res) => {
  if (req.user.role === ROLES.SUPER_ADMIN) {
    throw new AppError('Super Admin cannot disable authenticator app', 403, 'MFA_REQUIRED');
  }

  const authConfig = await AuthenticatorConfig.findOne({ user: req.user._id });
  if (authConfig) {
    authConfig.isEnabled = false;
    await authConfig.save();
  }

  successResponse(res, null, 'Authenticator app disabled');
});

export const updateMfaPreference = asyncHandler(async (req, res) => {
  const { mfaPreference, emailOtpEnabled } = req.body;
  const settings = await getOrCreateSecuritySettings(req.user._id);
  const authConfig = await AuthenticatorConfig.findOne({ user: req.user._id });

  const updates = {};
  if (mfaPreference) {
    if (!MFA_PREFERENCES.includes(mfaPreference)) {
      throw new AppError('Invalid MFA preference', 400);
    }
    updates.mfaPreference = mfaPreference;
  }
  if (emailOtpEnabled !== undefined) {
    updates.emailOtpEnabled = emailOtpEnabled;
  }

  if (req.user.role === ROLES.SUPER_ADMIN) {
    if (updates.mfaPreference === 'otp' && updates.emailOtpEnabled === false) {
      throw new AppError('Super Admin must keep email OTP or use both methods', 400);
    }
    if (!authConfig?.isEnabled && updates.mfaPreference !== 'otp' && updates.mfaPreference !== 'both') {
      throw new AppError('Super Admin must use authenticator app', 400);
    }
    if (updates.emailOtpEnabled === false && !authConfig?.isEnabled) {
      throw new AppError('Super Admin cannot disable all MFA options', 400);
    }
  }

  enforceSuperAdminMfaRules(req.user, settings, updates);

  if (updates.mfaPreference === 'totp' && !authConfig?.isEnabled) {
    throw new AppError('Enable authenticator app before selecting TOTP-only mode', 400);
  }

  Object.assign(settings, updates);
  await settings.save();

  successResponse(res, {
    mfaPreference: settings.mfaPreference,
    emailOtpEnabled: settings.emailOtpEnabled,
    totpEnabled: authConfig?.isEnabled || false,
  }, 'MFA preferences updated');
});

export const toggleEmailOtp = asyncHandler(async (req, res) => {
  const { enabled } = req.body;
  const settings = await getOrCreateSecuritySettings(req.user._id);
  const authConfig = await AuthenticatorConfig.findOne({ user: req.user._id });

  if (req.user.role === ROLES.SUPER_ADMIN && enabled === false && !authConfig?.isEnabled) {
    throw new AppError('Super Admin cannot disable all MFA options', 400);
  }

  if (enabled === false && settings.mfaPreference === 'otp' && !authConfig?.isEnabled) {
    throw new AppError('Enable another MFA method before disabling email OTP', 400);
  }

  settings.emailOtpEnabled = enabled;
  await settings.save();

  successResponse(res, { emailOtpEnabled: settings.emailOtpEnabled }, 'Email OTP setting updated');
});

export const removeTrustedDevice = asyncHandler(async (req, res) => {
  const { fingerprint } = req.params;
  const settings = await getOrCreateSecuritySettings(req.user._id);
  settings.trustedDevices = (settings.trustedDevices || []).filter(
    (d) => d.fingerprint !== fingerprint
  );
  await settings.save();
  successResponse(res, settings.trustedDevices, 'Trusted device removed');
});

export const updateNotificationPreferences = asyncHandler(async (req, res) => {
  const settings = await getOrCreateSecuritySettings(req.user._id);
  const { email, followUp, assignment, security } = req.body;

  if (!settings.notifications) settings.notifications = {};
  if (email !== undefined) settings.notifications.email = email;
  if (followUp !== undefined) settings.notifications.followUp = followUp;
  if (assignment !== undefined) settings.notifications.assignment = assignment;
  if (security !== undefined) settings.notifications.security = security;

  await settings.save();
  successResponse(res, settings.notifications, 'Notification preferences updated');
});

/** Mark first-login welcome guide as completed. */
export const completeWelcomeGuide = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) throw new AppError('User not found', 404);

  user.hasSeenWelcomeGuide = true;
  await user.save();

  successResponse(res, sanitizeUser(user), 'Welcome guide completed');
});
