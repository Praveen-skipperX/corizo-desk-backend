import dotenv from 'dotenv';

dotenv.config();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  mongodbUri: process.env.MONGODB_URI,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '30d',
  },
  email: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM || 'noreply@corizo.in',
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  otp: {
    expirySeconds: parseInt(process.env.OTP_EXPIRY_SECONDS, 10) || 300,
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 3,
    resendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS, 10) || 60,
  },
  security: {
    loginMaxAttempts: parseInt(process.env.LOGIN_MAX_ATTEMPTS, 10) || 3,
    accountLockDurationSeconds: parseInt(process.env.ACCOUNT_LOCK_DURATION_SECONDS, 10) || 1800,
    // 30 days — remain logged in on a trusted device until logout
    sessionTtlSeconds: parseInt(process.env.SESSION_TTL_SECONDS, 10) || 2592000,
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 2000,
  },
  creatorRemarkEditWindowMinutes: parseInt(process.env.CREATOR_REMARK_EDIT_WINDOW_MINUTES, 10) || 15,
  google: {
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  },
};

export default config;
