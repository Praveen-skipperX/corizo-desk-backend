import speakeasy from 'speakeasy';
import { AppError, asyncHandler } from '../utils/apiResponse.js';
import { User, AuthenticatorConfig } from '../models/index.js';
import { getOtp, deleteOtp } from '../services/redisService.js';
import { decryptSecret } from '../utils/encryption.js';

const getTotpSecret = (authConfig) => decryptSecret(authConfig?.secret);

export const verifyUserReauth = async (user, { password, totpCode, emailOtp }) => {
  if (!password && !totpCode && !emailOtp) {
    throw new AppError('Re-authentication required. Provide password, TOTP, or email OTP.', 401, 'REAUTH_REQUIRED');
  }

  const userDoc = await User.findById(user._id).select('+password');

  if (emailOtp) {
    const stored = await getOtp(userDoc.email);
    if (!stored || stored !== emailOtp) {
      throw new AppError('Invalid or expired email OTP', 401, 'INVALID_OTP');
    }
    await deleteOtp(userDoc.email);
    return;
  }

  if (password) {
    if (!userDoc.password) {
      throw new AppError('Password not set for this account. Use TOTP verification.', 400, 'NO_PASSWORD');
    }
    const valid = await userDoc.comparePassword(password);
    if (!valid) {
      throw new AppError('Invalid password', 401, 'INVALID_PASSWORD');
    }
    return;
  }

  const authConfig = await AuthenticatorConfig.findOne({ user: userDoc._id }).select('+secret');
  if (!authConfig?.isEnabled) {
    throw new AppError('Authenticator not enabled. Use password verification.', 400, 'TOTP_NOT_ENABLED');
  }

  const verified = speakeasy.totp.verify({
    secret: getTotpSecret(authConfig),
    encoding: 'base32',
    token: totpCode,
    window: 1,
  });

  if (!verified) {
    throw new AppError('Invalid TOTP code', 401, 'INVALID_TOTP');
  }
};

export const verifySensitiveAction = asyncHandler(async (req, res, next) => {
  await verifyUserReauth(req.user, req.body);
  next();
});
