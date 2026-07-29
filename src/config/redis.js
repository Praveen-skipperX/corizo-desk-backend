import Redis from 'ioredis';
import config from './index.js';
import logger from '../utils/logger.js';

let redisClient = null;

export const getRedisClient = () => {
  const redisUrl = process.env.REDIS_URL || config.redisUrl;

  if (!redisClient) {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    redisClient.on('connect', () => logger.info('Redis connected'));
    redisClient.on('error', (err) => logger.error('Redis error:', err));
  }
  return redisClient;
};

export const REDIS_KEYS = {
  otp: (email) => `otp:${email}`,
  otpAttempts: (email) => `otp:attempts:${email}`,
  otpCooldown: (email) => `otp:cooldown:${email}`,
  loginAttempts: (email) => `login:attempts:${email}`,
  session: (sessionId) => `session:${sessionId}`,
  refreshToken: (tokenId) => `refresh:${tokenId}`,
  dashboardStats: (scope, id) => `dashboard:v3:${scope}:${id}`,
  leadCache: (id) => `lead:${id}`,
  userSessions: (userId) => `user:sessions:${userId}`,
  emailChange: (userId) => `email:change:${userId}`,
  passwordVerified: (email) => `login:pwd-verified:${email.toLowerCase()}`,
  rateLimit: (ip) => `ratelimit:${ip}`,
};

export default getRedisClient;
