import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLES } from '../constants/index.js';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    username: { type: String, unique: true, sparse: true, trim: true },
    password: { type: String, select: false },
    phone: { type: String, trim: true },
    role: {
      type: String,
      enum: Object.values(ROLES),
      required: true,
      index: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      index: true,
    },
    /** Google Sheets this employee may access (leads from these connectors). */
    allowedConnectors: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Connector',
    }],
    isActive: { type: Boolean, default: true, index: true },
    deletedAt: { type: Date, default: null, index: true },
    isLocked: { type: Boolean, default: false },
    lockedAt: Date,
    lockedReason: String,
    lastLoginAt: Date,
    lastLoginIp: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    avatar: String,
    mustSetPasswordOnFirstLogin: { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: false },
    passwordSetAt: Date,
    /** First-login panel walkthrough — shown once until dismissed. */
    hasSeenWelcomeGuide: { type: Boolean, default: false },
    metadata: {
      deviceFingerprints: [String],
      knownIps: [String],
    },
  },
  { timestamps: true }
);

userSchema.index({ createdBy: 1, role: 1 });
userSchema.index({ department: 1, role: 1 });
userSchema.index({ email: 1, isActive: 1 });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function comparePassword(candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

const User = mongoose.model('User', userSchema);
export default User;
