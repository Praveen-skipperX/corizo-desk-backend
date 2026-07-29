import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import config from '../config/index.js';
import { getRedisClient } from '../config/redis.js';

const SKIP_RATE_LIMIT_PATHS = [
  '/connectors/sync-progress',
  '/auth/refresh',
  '/auth/me',
];

export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  // SPA polls + dashboards need headroom; default 100 was too low
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => getRedisClient().call(...args),
    prefix: 'rl:api:',
  }),
  skip: (req) => {
    const path = req.path || '';
    return SKIP_RATE_LIMIT_PATHS.some((p) => path === p || path.endsWith(p));
  },
  message: { success: false, message: 'Too many requests, please try again later' },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => getRedisClient().call(...args),
    prefix: 'rl:auth:',
  }),
  message: { success: false, message: 'Too many authentication attempts' },
});

export const otpRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => getRedisClient().call(...args),
    prefix: 'rl:otp:',
  }),
  message: { success: false, message: 'OTP request limit exceeded' },
});
