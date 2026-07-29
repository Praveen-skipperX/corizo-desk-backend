import mongoose from 'mongoose';

const authenticatorConfigSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    secret: { type: String, required: true, select: false },
    isEnabled: { type: Boolean, default: false },
    backupCodes: [{ type: String, select: false }],
    verifiedAt: Date,
    lastUsedAt: Date,
  },
  { timestamps: true }
);

const AuthenticatorConfig = mongoose.model('AuthenticatorConfig', authenticatorConfigSchema);
export default AuthenticatorConfig;
