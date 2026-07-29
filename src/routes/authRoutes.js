import { Router } from 'express';
import {
  sendOtp,
  verifyOtp,
  employeeLogin,
  getOtpStatus,
  superAdminLogin,
  verifyTotp,
  employeeVerifyTotp,
  refreshToken,
  logout,
  getMe,
  unlockAccount,
  setupPassword,
} from '../controllers/authController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authRateLimiter, otpRateLimiter } from '../middleware/rateLimiter.js';
import {
  sendOtpSchema,
  employeeLoginSchema,
  verifyOtpSchema,
  otpStatusSchema,
  superAdminLoginSchema,
  verifyTotpSchema,
  setupPasswordSchema,
} from '../validators/schemas.js';
import { ROLES } from '../constants/index.js';

const router = Router();

router.post('/otp/send', otpRateLimiter, authRateLimiter, validate(sendOtpSchema), sendOtp);
router.post('/employee/login', authRateLimiter, validate(employeeLoginSchema), employeeLogin);
router.get('/otp/status', authRateLimiter, validate(otpStatusSchema), getOtpStatus);
router.post('/otp/verify', authRateLimiter, validate(verifyOtpSchema), verifyOtp);
router.post('/super-admin/login', authRateLimiter, validate(superAdminLoginSchema), superAdminLogin);
router.post('/super-admin/verify-totp', authRateLimiter, validate(verifyTotpSchema), verifyTotp);
router.post('/employee/verify-totp', authRateLimiter, validate(verifyTotpSchema), employeeVerifyTotp);
router.post('/refresh', refreshToken);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getMe);
router.post('/setup-password', authenticate, validate(setupPasswordSchema), setupPassword);
router.post('/unlock/:id', authenticate, authorize(ROLES.SUPER_ADMIN), unlockAccount);

export default router;
