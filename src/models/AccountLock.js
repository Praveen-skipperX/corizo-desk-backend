import mongoose from 'mongoose';

const accountLockSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, required: true, index: true },
    reason: { type: String, default: 'Too many failed login attempts' },
    lockedAt: { type: Date, default: Date.now },
    unlockedAt: Date,
    unlockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isActive: { type: Boolean, default: true, index: true },
    attemptCount: { type: Number, default: 0 },
    ipAddress: String,
  },
  { timestamps: true }
);

const AccountLock = mongoose.model('AccountLock', accountLockSchema);
export default AccountLock;
