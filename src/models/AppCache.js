import mongoose from 'mongoose';

/**
 * Durable short-lived cache for serverless (when REDIS_URL is not hosted).
 * TTL index auto-expires documents.
 */
const appCacheSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

appCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AppCache = mongoose.model('AppCache', appCacheSchema);
export default AppCache;
