import { Router } from 'express';
import { z } from 'zod';
import {
  getAccountSettings,
  updateProfile,
  changePassword,
  requestEmailChange,
  verifyEmailChange,
  getAccountActivity,
  getActiveSessions,
  revokeSession,
  revokeAllOtherSessions,
  getSecurityDashboard,
  setupTotp,
  verifyTotpSetup,
  disableTotp,
  updateMfaPreference,
  toggleEmailOtp,
  removeTrustedDevice,
  updateNotificationPreferences,
  completeWelcomeGuide,
} from '../controllers/settingsController.js';
import {
  getSystemAppSettings,
  updateSystemAppSettings,
} from '../controllers/appSettingsController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { verifySensitiveAction } from '../middleware/verifyReauth.js';
import { validate } from '../middleware/validate.js';
import {
  updateProfileSchema,
  changePasswordSchema,
  emailChangeSchema,
  verifyEmailChangeSchema,
  mfaPreferenceSchema,
  totpVerifySchema,
} from '../validators/schemas.js';
import { ROLES } from '../constants/index.js';

const router = Router();

router.use(authenticate);

const appSettingsSchema = z.object({
  body: z.object({
    adminRemarksEnabled: z.boolean(),
  }),
});

/** Authenticated users can read flags so the UI can show/hide features */
router.get('/app', getSystemAppSettings);
router.patch(
  '/app',
  authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  validate(appSettingsSchema),
  updateSystemAppSettings
);

router.get('/', getAccountSettings);
router.get('/activity', getAccountActivity);
router.get('/sessions', getActiveSessions);
router.get('/security', getSecurityDashboard);

router.patch('/profile', validate(updateProfileSchema), updateProfile);
router.post('/change-password', verifySensitiveAction, validate(changePasswordSchema), changePassword);
router.post('/email/request', verifySensitiveAction, validate(emailChangeSchema), requestEmailChange);
router.post('/email/verify', validate(verifyEmailChangeSchema), verifyEmailChange);

router.delete('/sessions/others', verifySensitiveAction, revokeAllOtherSessions);
router.delete('/sessions/:sessionId', revokeSession);
router.delete('/devices/:fingerprint', removeTrustedDevice);

router.post('/mfa/totp/setup', verifySensitiveAction, setupTotp);
router.post('/mfa/totp/verify', validate(totpVerifySchema), verifyTotpSetup);
router.post('/mfa/totp/disable', verifySensitiveAction, disableTotp);
router.patch('/mfa/preference', verifySensitiveAction, validate(mfaPreferenceSchema), updateMfaPreference);
router.patch('/mfa/email-otp', verifySensitiveAction, toggleEmailOtp);
router.patch('/notifications', updateNotificationPreferences);
router.post('/welcome-guide/complete', completeWelcomeGuide);

export default router;
