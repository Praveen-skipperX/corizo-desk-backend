import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import config from '../config/index.js';
import { AppError, asyncHandler, successResponse } from '../utils/apiResponse.js';
import { generateOtp, sanitizeUser } from '../utils/helpers.js';
import { getPermissionsForRoleSlug } from '../services/permissionService.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../constants/permissions.js';
import { validatePasswordStrength, assertPasswordsMatch } from '../utils/password.js';
import { decryptSecret, encryptSecret } from '../utils/encryption.js';
import {
  User,
  LoginAttempt,
  AccountLock,
  AuthenticatorConfig,
} from '../models/index.js';
import UserSecuritySettings from '../models/UserSecuritySettings.js';
import { ROLES } from '../constants/index.js';
import {
  storeOtp,
  getOtp,
  deleteOtp,
  incrementOtpAttempts,
  getOtpAttempts,
  getOtpTtl,
  getOtpCooldownTtl,
  isOtpCooldownActive,
  setOtpCooldown,
  incrementLoginAttempts,
  resetLoginAttempts,
  setPasswordVerified,
  isPasswordVerified,
  clearPasswordVerified,
  generateAccessToken,
  generateRefreshToken,
  storeSession,
  touchSession,
  getSession,
  storeRefreshToken,
  verifyRefreshToken,
  isRefreshTokenValid,
  revokeRefreshToken,
  deleteSession,
} from '../services/redisService.js';
import { addEmailJob } from '../queues/index.js';
import { sendOtpEmail } from '../services/emailService.js';
import logger from '../utils/logger.js';
import { logActivity, ACTIVITY_ACTIONS, ENTITY_TYPES } from '../services/auditService.js';

const getTotpSecret = (authConfig) => decryptSecret(authConfig?.secret);

const refreshCookieOptions = () => {
  const isProd = config.env === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    // Cross-site (Vercel frontend → API host) needs SameSite=None + Secure
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
    maxAge: config.security.sessionTtlSeconds * 1000,
  };
};

const resolvePermissionsForUser = async (user) => {
  let permissions = await getPermissionsForRoleSlug(user.role);
  if (!permissions.length && DEFAULT_ROLE_PERMISSIONS[user.role]) {
    permissions = DEFAULT_ROLE_PERMISSIONS[user.role].map((g) => ({
      key: g.key,
      scope: g.scope,
    }));
  }
  return permissions;
};

const toAuthUserPayload = async (user) => {
  const base = sanitizeUser(user);
  const permissions = await resolvePermissionsForUser(user);
  return {
    ...base,
    permissions,
    permissionKeys: permissions.map((p) => p.key),
  };
};

const getEmployeeMfaConfig = async (userId) => {
  const [settings, authConfig] = await Promise.all([
    UserSecuritySettings.findOne({ user: userId }),
    AuthenticatorConfig.findOne({ user: userId }),
  ]);

  const preference = settings?.mfaPreference || 'otp';
  const emailOtpEnabled = settings?.emailOtpEnabled !== false;
  const totpEnabled = authConfig?.isEnabled || false;

  let requiresEmailOtp = false;
  let requiresTotp = false;

  if (preference === 'otp') {
    requiresEmailOtp = emailOtpEnabled;
  } else if (preference === 'totp') {
    if (totpEnabled) {
      requiresTotp = true;
    } else {
      requiresEmailOtp = emailOtpEnabled;
    }
  } else if (preference === 'both') {
    requiresEmailOtp = emailOtpEnabled;
    requiresTotp = totpEnabled;
  }

  return { preference, requiresEmailOtp, requiresTotp, totpEnabled, emailOtpEnabled };
};

const issueEmployeeTotpChallenge = (userId, extra = {}) => jwt.sign(
  { userId, step: 'employee_totp', ...extra },
  config.jwt.accessSecret,
  { expiresIn: '5m' }
);

const completeEmployeeLogin = async (user, req, res, method = 'otp') => {
  await resetLoginAttempts(user.email);
  user.lastLoginAt = new Date();
  user.lastLoginIp = req.clientIp;
  await user.save();

  await LoginAttempt.create({
    email: user.email,
    user: user._id,
    success: true,
    method,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  const tokens = await createAuthTokens(user, req);

  await logActivity({
    user,
    action: ACTIVITY_ACTIONS.LOGIN,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
    metadata: { method },
  });

  res.cookie('refreshToken', tokens.refreshToken, refreshCookieOptions());

  successResponse(res, {
    user: await toAuthUserPayload(user),
    accessToken: tokens.accessToken,
    requiresPasswordSetup: user.mustSetPasswordOnFirstLogin || user.mustChangePassword,
  }, 'Login successful');
};

const createAuthTokens = async (user, req, { sessionId: existingSessionId } = {}) => {
  const sessionId = existingSessionId || uuidv4();
  const payload = { userId: user._id, role: user.role, sessionId };

  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);
  const decoded = jwt.decode(refreshToken);

  if (existingSessionId) {
    const existing = await getSession(existingSessionId);
    if (existing) {
      await touchSession(existingSessionId);
    } else {
      await storeSession(sessionId, {
        userId: user._id.toString(),
        role: user.role,
        createdAt: new Date().toISOString(),
        ip: req.clientIp,
        device: req.deviceInfo,
      });
    }
  } else {
    await storeSession(sessionId, {
      userId: user._id.toString(),
      role: user.role,
      createdAt: new Date().toISOString(),
      ip: req.clientIp,
      device: req.deviceInfo,
    });
  }

  if (decoded?.jti) {
    await storeRefreshToken(decoded.jti, user._id);
  }

  return { accessToken, refreshToken, sessionId };
};

export const sendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email: email.toLowerCase(), isActive: true });

  if (!user) {
    throw new AppError('No account found with this email', 404, 'USER_NOT_FOUND');
  }

  if (user.role === ROLES.SUPER_ADMIN) {
    throw new AppError('Super Admin must use password login', 400, 'USE_PASSWORD_LOGIN');
  }

  if (user.isLocked) {
    throw new AppError('Account is locked. Contact Super Admin.', 403, 'ACCOUNT_LOCKED');
  }

  if (await isOtpCooldownActive(email)) {
    throw new AppError('Please wait before requesting another OTP', 429, 'OTP_COOLDOWN');
  }

  const otp = generateOtp();
  await storeOtp(email, otp);
  await setOtpCooldown(email);

  try {
    await sendOtpEmail(user.email, otp, user.name);
  } catch (err) {
    logger.error('OTP email delivery failed:', { email: user.email, error: err.message });
    if (config.env === 'development') {
      logger.info(`[DEV OTP FALLBACK] ${user.email}: ${otp}`);
    } else {
      throw new AppError('Failed to send OTP email. Please try again.', 503, 'EMAIL_SEND_FAILED');
    }
  }

  await logActivity({
    user,
    action: ACTIVITY_ACTIONS.OTP_SENT,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, {
    email: user.email,
    expiresIn: config.otp.expirySeconds,
    resendCooldown: config.otp.resendCooldownSeconds,
    maxAttempts: config.otp.maxAttempts,
  }, 'OTP sent to your email');
});

export const employeeLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const identifier = String(email || '').trim();
  const normalizedEmail = identifier.toLowerCase();

  const user = await User.findOne({
    isActive: true,
    $or: [{ email: normalizedEmail }, { username: identifier }, { username: normalizedEmail }],
  }).select('+password');

  if (!user) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const loginEmail = user.email.toLowerCase();

  if (user.isLocked) {
    throw new AppError('Account is locked. Contact your administrator.', 403, 'ACCOUNT_LOCKED');
  }

  if (!user.password) {
    throw new AppError(
      'Password not configured. Contact your administrator to set up your account.',
      400,
      'PASSWORD_NOT_SET'
    );
  }

  const isValid = await user.comparePassword(password);
  if (!isValid) {
    const attempts = await incrementLoginAttempts(loginEmail);
    await LoginAttempt.create({
      email: loginEmail,
      user: user._id,
      success: false,
      method: 'password',
      ipAddress: req.clientIp,
      deviceInfo: req.deviceInfo,
      failureReason: 'Invalid password',
    });

    if (attempts >= config.security.loginMaxAttempts) {
      user.isLocked = true;
      user.lockedAt = new Date();
      user.lockedReason = 'Too many failed login attempts';
      await user.save();
      throw new AppError('Account locked due to too many failed attempts', 403, 'ACCOUNT_LOCKED');
    }

    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  // Super Admin uses the same login page — password then authenticator (no email OTP)
  if (user.role === ROLES.SUPER_ADMIN) {
    await resetLoginAttempts(loginEmail);

    const authConfig = await AuthenticatorConfig.findOne({ user: user._id }).select('+secret');

    if (!authConfig?.isEnabled) {
      const secret = speakeasy.generateSecret({ name: `Corizo Desk (${user.username || user.email})` });
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

      await AuthenticatorConfig.findOneAndUpdate(
        { user: user._id },
        { secret: encryptSecret(secret.base32), isEnabled: false },
        { upsert: true }
      );

      const tempToken = jwt.sign(
        { userId: user._id, setup: true },
        config.jwt.accessSecret,
        { expiresIn: '10m' }
      );

      return successResponse(res, {
        email: user.email,
        mfaPreference: 'totp',
        requiresEmailOtp: false,
        requiresTotp: true,
        requiresTotpSetup: true,
        tempToken,
        qrCodeUrl,
        secret: secret.base32,
      }, 'TOTP setup required');
    }

    const tempToken = jwt.sign(
      { userId: user._id, step: 'totp' },
      config.jwt.accessSecret,
      { expiresIn: '5m' }
    );

    return successResponse(res, {
      email: user.email,
      mfaPreference: 'totp',
      requiresEmailOtp: false,
      requiresTotp: true,
      tempToken,
    }, 'Enter your authenticator code');
  }

  const mfa = await getEmployeeMfaConfig(user._id);

  await resetLoginAttempts(loginEmail);
  await setPasswordVerified(loginEmail, config.otp.expirySeconds + 300);

  if (mfa.requiresTotp && !mfa.requiresEmailOtp) {
    const tempToken = issueEmployeeTotpChallenge(user._id);
    return successResponse(res, {
      email: user.email,
      mfaPreference: mfa.preference,
      requiresEmailOtp: false,
      requiresTotp: true,
      tempToken,
    }, 'Enter your authenticator code');
  }

  if (!mfa.requiresEmailOtp) {
    throw new AppError('No sign-in verification method is enabled. Contact your administrator.', 400, 'MFA_NOT_CONFIGURED');
  }

  if (await isOtpCooldownActive(loginEmail)) {
    throw new AppError('Please wait before requesting another verification code', 429, 'OTP_COOLDOWN');
  }

  const otp = generateOtp();
  await storeOtp(loginEmail, otp);
  await setOtpCooldown(loginEmail);

  try {
    await sendOtpEmail(user.email, otp, user.name);
  } catch (err) {
    logger.error('OTP email delivery failed:', { email: user.email, error: err.message });
    if (config.env === 'development') {
      logger.info(`[DEV OTP FALLBACK] ${user.email}: ${otp}`);
    } else {
      await clearPasswordVerified(loginEmail);
      throw new AppError('Failed to send verification code. Please try again.', 503, 'EMAIL_SEND_FAILED');
    }
  }

  await logActivity({
    user,
    action: ACTIVITY_ACTIONS.OTP_SENT,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    metadata: { step: 'post_password_verification', mfaPreference: mfa.preference },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, {
    email: user.email,
    expiresIn: config.otp.expirySeconds,
    resendCooldown: config.otp.resendCooldownSeconds,
    maxAttempts: config.otp.maxAttempts,
    mfaPreference: mfa.preference,
    requiresEmailOtp: true,
    requiresTotp: mfa.requiresTotp,
  }, mfa.requiresTotp
    ? 'Email code sent. Authenticator verification will follow.'
    : 'Verification code sent to your email');
});

export const getOtpStatus = asyncHandler(async (req, res) => {
  const { email } = req.query;
  if (!email) throw new AppError('Email is required', 400);

  const normalizedEmail = email.toLowerCase();
  const [expiresIn, cooldownRemaining, attemptsUsed] = await Promise.all([
    getOtpTtl(normalizedEmail),
    getOtpCooldownTtl(normalizedEmail),
    getOtpAttempts(normalizedEmail),
  ]);

  successResponse(res, {
    expiresIn,
    cooldownRemaining,
    attemptsRemaining: Math.max(0, config.otp.maxAttempts - attemptsUsed),
    maxAttempts: config.otp.maxAttempts,
    resendCooldownSeconds: config.otp.resendCooldownSeconds,
    expirySeconds: config.otp.expirySeconds,
  });
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() })
    .populate('department', 'name code isActive')
    .select('+password');

  if (!user || !user.isActive) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  if (user.isLocked) {
    throw new AppError('Account is locked', 403, 'ACCOUNT_LOCKED');
  }

  if (user.role !== ROLES.SUPER_ADMIN) {
    const passwordGate = await isPasswordVerified(email.toLowerCase());
    if (!passwordGate) {
      throw new AppError('Complete password verification before entering the code', 401, 'PASSWORD_VERIFICATION_REQUIRED');
    }
  }

  const storedOtp = await getOtp(email);
  if (!storedOtp) {
    throw new AppError('OTP expired. Please request a new one.', 400, 'OTP_EXPIRED');
  }

  const attempts = await incrementOtpAttempts(email);
  if (attempts > config.otp.maxAttempts) {
    await deleteOtp(email);
    throw new AppError(
      'Too many OTP attempts. Please request a new code.',
      429,
      'OTP_MAX_ATTEMPTS',
      { attemptsRemaining: 0 }
    );
  }

  if (storedOtp !== otp) {
    await LoginAttempt.create({
      email,
      user: user._id,
      success: false,
      method: 'otp',
      ipAddress: req.clientIp,
      deviceInfo: req.deviceInfo,
      failureReason: 'Invalid OTP',
    });

    const loginAttempts = await incrementLoginAttempts(email);
    const attemptsRemaining = Math.max(0, config.otp.maxAttempts - attempts);

    if (loginAttempts >= config.security.loginMaxAttempts) {
      user.isLocked = true;
      user.lockedAt = new Date();
      user.lockedReason = 'Too many failed login attempts';
      await user.save();

      await AccountLock.create({
        user: user._id,
        email: user.email,
        attemptCount: loginAttempts,
        ipAddress: req.clientIp,
      });

      await addEmailJob({ type: 'account_locked', email: user.email, name: user.name });

      await logActivity({
        user,
        action: ACTIVITY_ACTIONS.ACCOUNT_LOCK,
        entityType: ENTITY_TYPES.USER,
        entityId: user._id,
        ipAddress: req.clientIp,
        deviceInfo: req.deviceInfo,
      });

      await deleteOtp(email);
      throw new AppError(
        'Account locked due to too many failed attempts. Contact your administrator.',
        403,
        'ACCOUNT_LOCKED',
        { attemptsRemaining: 0 }
      );
    }

    throw new AppError(
      `Invalid verification code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`,
      401,
      'INVALID_OTP',
      { attemptsRemaining }
    );
  }

  await deleteOtp(email);
  await clearPasswordVerified(email.toLowerCase());

  if (user.role !== ROLES.SUPER_ADMIN) {
    const mfa = await getEmployeeMfaConfig(user._id);
    if (mfa.requiresTotp && mfa.totpEnabled) {
      const tempToken = issueEmployeeTotpChallenge(user._id, { emailVerified: true });
      return successResponse(res, {
        requiresTotp: true,
        tempToken,
        mfaPreference: mfa.preference,
      }, 'Enter your authenticator code');
    }
  }

  await completeEmployeeLogin(user, req, res, 'otp');
});

export const superAdminLogin = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({
    $or: [{ username }, { email: username }],
    role: ROLES.SUPER_ADMIN,
    isActive: true,
  }).select('+password');

  if (!user) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  if (user.isLocked) {
    throw new AppError('Account is locked', 403, 'ACCOUNT_LOCKED');
  }

  const isValid = await user.comparePassword(password);
  if (!isValid) {
    const attempts = await incrementLoginAttempts(user.email);
    await LoginAttempt.create({
      email: user.email,
      user: user._id,
      success: false,
      method: 'password',
      ipAddress: req.clientIp,
      deviceInfo: req.deviceInfo,
      failureReason: 'Invalid password',
    });

    if (attempts >= config.security.loginMaxAttempts) {
      user.isLocked = true;
      user.lockedAt = new Date();
      await user.save();
      throw new AppError('Account locked', 403, 'ACCOUNT_LOCKED');
    }

    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  const authConfig = await AuthenticatorConfig.findOne({ user: user._id }).select('+secret');

  if (!authConfig?.isEnabled) {
    const secret = speakeasy.generateSecret({ name: `Corizo Desk (${user.username})` });
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    await AuthenticatorConfig.findOneAndUpdate(
      { user: user._id },
      { secret: encryptSecret(secret.base32), isEnabled: false },
      { upsert: true }
    );

    const tempToken = jwt.sign(
      { userId: user._id, setup: true },
      config.jwt.accessSecret,
      { expiresIn: '10m' }
    );

    return successResponse(res, {
      requiresTotpSetup: true,
      tempToken,
      qrCodeUrl,
      secret: secret.base32,
    }, 'TOTP setup required');
  }

  const tempToken = jwt.sign(
    { userId: user._id, step: 'totp' },
    config.jwt.accessSecret,
    { expiresIn: '5m' }
  );

  successResponse(res, { requiresTotp: true, tempToken }, 'Enter TOTP code');
});

export const verifyTotp = asyncHandler(async (req, res) => {
  const { tempToken, totpCode } = req.body;

  let decoded;
  try {
    decoded = jwt.verify(tempToken, config.jwt.accessSecret);
  } catch {
    throw new AppError('Session expired', 401, 'SESSION_EXPIRED');
  }

  const user = await User.findById(decoded.userId).populate('department', 'name code isActive');
  if (!user) throw new AppError('User not found', 404);

  const authConfig = await AuthenticatorConfig.findOne({ user: user._id }).select('+secret');
  if (!authConfig) throw new AppError('Authenticator not configured', 400);

  const isEmployeeFlow = decoded.step === 'employee_totp';

  if (decoded.setup) {
    const verified = speakeasy.totp.verify({
      secret: getTotpSecret(authConfig),
      encoding: 'base32',
      token: totpCode,
      window: 1,
    });

    if (!verified) throw new AppError('Invalid TOTP code', 401, 'INVALID_TOTP');

    authConfig.isEnabled = true;
    authConfig.verifiedAt = new Date();
    await authConfig.save();
  } else {
    const verified = speakeasy.totp.verify({
      secret: getTotpSecret(authConfig),
      encoding: 'base32',
      token: totpCode,
      window: 1,
    });

    if (!verified) {
      throw new AppError('Invalid TOTP code', 401, 'INVALID_TOTP');
    }

    authConfig.lastUsedAt = new Date();
    await authConfig.save();
  }

  if (isEmployeeFlow) {
    await clearPasswordVerified(user.email.toLowerCase());
    const loginMethod = decoded.emailVerified ? 'both' : 'totp';
    return completeEmployeeLogin(user, req, res, loginMethod);
  }

  await resetLoginAttempts(user.email);
  user.lastLoginAt = new Date();
  user.lastLoginIp = req.clientIp;
  await user.save();

  const tokens = await createAuthTokens(user, req);

  await logActivity({
    user,
    action: ACTIVITY_ACTIONS.LOGIN,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
    metadata: { method: 'totp' },
  });

  res.cookie('refreshToken', tokens.refreshToken, refreshCookieOptions());

  successResponse(res, {
    user: await toAuthUserPayload(user),
    accessToken: tokens.accessToken,
    requiresPasswordSetup: user.mustSetPasswordOnFirstLogin || user.mustChangePassword,
  }, 'Login successful');
});

export const employeeVerifyTotp = verifyTotp;

export const refreshToken = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken || req.body.refreshToken;
  if (!token) throw new AppError('Refresh token required', 401);

  let decoded;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    throw new AppError('Invalid refresh token', 401);
  }

  if (!decoded?.jti || !decoded?.userId) {
    throw new AppError('Invalid refresh token', 401);
  }

  const jtiValid = await isRefreshTokenValid(decoded.jti);
  // Allow recovery when Redis was wiped (e.g. local in-memory Redis restart)
  // but the refresh JWT cookie is still within expiry.
  if (jtiValid) {
    await revokeRefreshToken(decoded.jti);
  }

  const user = await User.findById(decoded.userId).populate('department');
  if (!user?.isActive) throw new AppError('User inactive', 401);

  // Keep the same device session (sliding expiry) instead of forcing a new login identity.
  const existingSession = decoded.sessionId ? await getSession(decoded.sessionId) : null;

  const tokens = await createAuthTokens(user, req, {
    sessionId: existingSession ? decoded.sessionId : undefined,
  });

  res.cookie('refreshToken', tokens.refreshToken, refreshCookieOptions());

  successResponse(res, { accessToken: tokens.accessToken }, 'Token refreshed');
});

export const logout = asyncHandler(async (req, res) => {
  if (req.sessionId) {
    await deleteSession(req.sessionId);
  }

  const token = req.cookies?.refreshToken;
  if (token) {
    try {
      const decoded = verifyRefreshToken(token);
      if (decoded.jti) await revokeRefreshToken(decoded.jti);
    } catch {
      /* ignore */
    }
  }

  res.clearCookie('refreshToken', {
    path: '/',
    sameSite: config.env === 'production' ? 'none' : 'lax',
    secure: config.env === 'production',
  });

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.LOGOUT,
    entityType: ENTITY_TYPES.USER,
    entityId: req.user?._id,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, null, 'Logged out successfully');
});

export const getMe = asyncHandler(async (req, res) => {
  const permissions = req.permissions?.length
    ? req.permissions
    : await resolvePermissionsForUser(req.user);

  successResponse(res, {
    ...sanitizeUser(req.user),
    permissions,
    permissionKeys: permissions.map((p) => p.key),
  });
});

export const setupPassword = asyncHandler(async (req, res) => {
  const { newPassword, confirmPassword } = req.body;

  assertPasswordsMatch(newPassword, confirmPassword);
  validatePasswordStrength(newPassword);

  const user = await User.findById(req.user._id).select('+password');
  if (!user.mustSetPasswordOnFirstLogin && !user.mustChangePassword) {
    throw new AppError('Password setup is not required for this account', 400);
  }

  if (user.mustChangePassword && user.password) {
    const sameAsCurrent = await user.comparePassword(newPassword);
    if (sameAsCurrent) {
      throw new AppError('Choose a different password than your temporary one', 400, 'PASSWORD_REUSE');
    }
  }

  const wasFirstSetup = user.mustSetPasswordOnFirstLogin;
  const wasForcedChange = user.mustChangePassword;

  user.password = newPassword;
  user.mustSetPasswordOnFirstLogin = false;
  user.mustChangePassword = false;
  user.passwordSetAt = new Date();
  await user.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.UPDATE,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    metadata: {
      action: wasFirstSetup ? 'initial_password_setup' : wasForcedChange ? 'one_time_password_change' : 'password_setup',
    },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, await toAuthUserPayload(user), 'Password created successfully');
});

export const unlockAccount = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const user = await User.findById(id);
  if (!user) throw new AppError('User not found', 404);

  user.isLocked = false;
  user.lockedAt = undefined;
  user.lockedReason = undefined;
  await user.save();

  await AccountLock.updateMany(
    { user: user._id, isActive: true },
    { isActive: false, unlockedAt: new Date(), unlockedBy: req.user._id }
  );

  await resetLoginAttempts(user.email);

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.ACCOUNT_UNLOCK,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, sanitizeUser(user), 'Account unlocked');
});
