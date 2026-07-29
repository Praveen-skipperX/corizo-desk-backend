import mongoose from 'mongoose';

const authRefreshTokenSchema = new mongoose.Schema(
  {
    jti: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

authRefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AuthRefreshToken = mongoose.model('AuthRefreshToken', authRefreshTokenSchema);
export default AuthRefreshToken;
