import mongoose from 'mongoose';

const loginAttemptSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    success: { type: Boolean, default: false },
    method: { type: String, enum: ['otp', 'password', 'totp', 'both'], default: 'otp' },
    ipAddress: String,
    deviceInfo: {
      userAgent: String,
      platform: String,
      mobile: String,
    },
    failureReason: String,
  },
  { timestamps: true }
);

loginAttemptSchema.index({ email: 1, createdAt: -1 });

const LoginAttempt = mongoose.model('LoginAttempt', loginAttemptSchema);
export default LoginAttempt;
