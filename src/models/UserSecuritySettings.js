import mongoose from 'mongoose';

const MFA_PREFERENCES = ['otp', 'totp', 'both'];

const userSecuritySettingsSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    emailOtpEnabled: { type: Boolean, default: true },
    mfaPreference: {
      type: String,
      enum: MFA_PREFERENCES,
      default: 'otp',
    },
    lastPasswordChangeAt: Date,
    trustedDevices: [{
      fingerprint: String,
      userAgent: String,
      platform: String,
      ipAddress: String,
      lastUsedAt: Date,
      label: String,
    }],
    notifications: {
      email: { type: Boolean, default: true },
      followUp: { type: Boolean, default: true },
      assignment: { type: Boolean, default: true },
      security: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export { MFA_PREFERENCES };
const UserSecuritySettings = mongoose.model('UserSecuritySettings', userSecuritySettingsSchema);
export default UserSecuritySettings;
