import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import config from '../config/index.js';
import { getRedisClient } from '../config/redis.js';

const SKIP_RATE_LIMIT_PATHS = [
  '/connectors/sync-progress',
  '/auth/refresh',
  '/auth/me',
];

const hostedRedis =
  Boolean(process.env.REDIS_URL) &&
  !String(process.env.REDIS_URL).includes('localhost') &&
  !String(process.env.REDIS_URL).includes('127.0.0.1');

const redisStore = (prefix) => {
  if (!hostedRedis) return undefined;
  return new RedisStore({
    sendCommand: (...args) => getRedisClient().call(...args),
    prefix,
  });
};

export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore('rl:api:'),
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
  store: redisStore('rl:auth:'),
  message: { success: false, message: 'Too many authentication attempts' },
});

export const otpRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore('rl:otp:'),
  message: { success: false, message: 'OTP request limit exceeded' },
});
