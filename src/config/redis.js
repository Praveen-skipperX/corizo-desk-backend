import Redis from 'ioredis';
import config from './index.js';
import logger from '../utils/logger.js';

let redisClient = null;

/**
 * Minimal in-memory Redis for Vercel when REDIS_URL is not configured.
 * Enough for sessions/OTP/login within a warm serverless instance.
 * Prefer Upstash REDIS_URL in production.
 */
class MemoryRedis {
  constructor() {
    this.data = new Map();
    this.sets = new Map();
    this.ttls = new Map();
  }

  #purge(key) {
    const exp = this.ttls.get(key);
    if (exp && Date.now() > exp) {
      this.data.delete(key);
      this.sets.delete(key);
      this.ttls.delete(key);
      return true;
    }
    return false;
  }

  #touchExpire(key, seconds) {
    if (seconds > 0) this.ttls.set(key, Date.now() + seconds * 1000);
  }

  on() {
    return this;
  }

  async ping() {
    return 'PONG';
  }

  async get(key) {
    this.#purge(key);
    return this.data.has(key) ? this.data.get(key) : null;
  }

  async exists(key) {
    this.#purge(key);
    return this.data.has(key) || this.sets.has(key) ? 1 : 0;
  }

  async set(key, value) {
    this.data.set(key, String(value));
    return 'OK';
  }

  async setex(key, seconds, value) {
    this.data.set(key, String(value));
    this.#touchExpire(key, Number(seconds) || 0);
    return 'OK';
  }

  async del(...keys) {
    let n = 0;
    for (const key of keys.flat()) {
      if (this.data.delete(key) || this.sets.delete(key)) n += 1;
      this.ttls.delete(key);
    }
    return n;
  }

  async incr(key) {
    this.#purge(key);
    const next = Number(this.data.get(key) || 0) + 1;
    this.data.set(key, String(next));
    return next;
  }

  async expire(key, seconds) {
    this.#purge(key);
    if (!this.data.has(key) && !this.sets.has(key)) return 0;
    this.#touchExpire(key, Number(seconds) || 0);
    return 1;
  }

  async ttl(key) {
    this.#purge(key);
    const exp = this.ttls.get(key);
    if (!exp) return -1;
    return Math.max(0, Math.ceil((exp - Date.now()) / 1000));
  }

  async sadd(key, ...members) {
    this.#purge(key);
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    const set = this.sets.get(key);
    let added = 0;
    for (const m of members.flat()) {
      const before = set.size;
      set.add(String(m));
      if (set.size > before) added += 1;
    }
    return added;
  }

  async srem(key, ...members) {
    this.#purge(key);
    const set = this.sets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const m of members.flat()) {
      if (set.delete(String(m))) removed += 1;
    }
    return removed;
  }

  async smembers(key) {
    this.#purge(key);
    const set = this.sets.get(key);
    return set ? [...set] : [];
  }

  async keys(pattern) {
    const prefix = String(pattern || '*').replace(/\*/g, '');
    const out = [];
    for (const key of this.data.keys()) {
      this.#purge(key);
      if (!prefix || key.startsWith(prefix) || pattern === '*') out.push(key);
    }
    for (const key of this.sets.keys()) {
      this.#purge(key);
      if (!out.includes(key) && (!prefix || key.startsWith(prefix) || pattern === '*')) out.push(key);
    }
    return out;
  }

  async call(command, ...args) {
    const cmd = String(command || '').toUpperCase();
    if (cmd === 'GET') return this.get(args[0]);
    if (cmd === 'SET') return this.set(args[0], args[1]);
    if (cmd === 'DEL') return this.del(...args);
    if (cmd === 'INCR') return this.incr(args[0]);
    if (cmd === 'EXPIRE') return this.expire(args[0], args[1]);
    if (cmd === 'PTTL') {
      const t = await this.ttl(args[0]);
      return t < 0 ? t : t * 1000;
    }
    if (cmd === 'PING') return this.ping();
    // rate-limit-redis may send EVAL — degrade gracefully
    return null;
  }
}

export const hasHostedRedis = () => {
  const url = process.env.REDIS_URL || config.redisUrl || '';
  if (!url) return false;
  if (url.includes('127.0.0.1') || url.includes('localhost')) return false;
  return true;
};

export const getRedisClient = () => {
  if (redisClient) return redisClient;

  if (!hasHostedRedis()) {
    if (process.env.VERCEL || config.env === 'production') {
      logger.warn('REDIS_URL missing — using in-memory Redis (sessions reset on cold start)');
    } else {
      logger.warn('Redis not configured — using in-memory Redis for local fallback');
    }
    redisClient = new MemoryRedis();
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL || config.redisUrl;
  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
  });

  redisClient.on('connect', () => logger.info('Redis connected'));
  redisClient.on('error', (err) => logger.error('Redis error:', err.message || err));

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

export const isUsingMemoryRedis = () => redisClient instanceof MemoryRedis;

export default getRedisClient;
