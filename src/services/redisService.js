import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import config from '../config/index.js';
import { getRedisClient, REDIS_KEYS } from '../config/redis.js';
import AuthSession from '../models/AuthSession.js';
import AuthRefreshToken from '../models/AuthRefreshToken.js';

export const generateAccessToken = (payload) => {
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiry,
  });
};

export const generateRefreshToken = (payload) => {
  return jwt.sign({ ...payload, jti: uuidv4() }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiry,
  });
};

export const verifyAccessToken = (token) => {
  return jwt.verify(token, config.jwt.accessSecret);
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, config.jwt.refreshSecret);
};

const sessionExpiryDate = () =>
  new Date(Date.now() + config.security.sessionTtlSeconds * 1000);

const persistSessionMongo = async (sessionId, data) => {
  const userId = data.userId;
  if (!userId) return;
  await AuthSession.findOneAndUpdate(
    { sessionId },
    {
      sessionId,
      userId,
      payload: data,
      expiresAt: sessionExpiryDate(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const readSessionMongo = async (sessionId) => {
  const row = await AuthSession.findOne({
    sessionId,
    expiresAt: { $gt: new Date() },
  }).lean();
  return row?.payload || null;
};

export const storeSession = async (sessionId, data) => {
  const redis = getRedisClient();
  await redis.setex(
    REDIS_KEYS.session(sessionId),
    config.security.sessionTtlSeconds,
    JSON.stringify(data)
  );
  if (data.userId) {
    await redis.sadd(REDIS_KEYS.userSessions(data.userId), sessionId);
    await redis.expire(REDIS_KEYS.userSessions(data.userId), config.security.sessionTtlSeconds);
  }
  // Durable store for Vercel / multi-instance (memory Redis is not shared)
  await persistSessionMongo(sessionId, data);
};

/** Sliding session: keep the device trusted until logout. */
export const touchSession = async (sessionId) => {
  const redis = getRedisClient();
  const key = REDIS_KEYS.session(sessionId);
  let parsed = null;
  const data = await redis.get(key);
  if (data) {
    parsed = JSON.parse(data);
  } else {
    parsed = await readSessionMongo(sessionId);
  }
  if (!parsed) return null;

  parsed.lastSeenAt = new Date().toISOString();
  await redis.setex(key, config.security.sessionTtlSeconds, JSON.stringify(parsed));
  if (parsed.userId) {
    await redis.expire(REDIS_KEYS.userSessions(parsed.userId), config.security.sessionTtlSeconds);
  }
  await persistSessionMongo(sessionId, parsed);
  return parsed;
};

export const getSession = async (sessionId) => {
  const redis = getRedisClient();
  const data = await redis.get(REDIS_KEYS.session(sessionId));
  if (data) return JSON.parse(data);

  const fromMongo = await readSessionMongo(sessionId);
  if (fromMongo) {
    // Re-hydrate Redis for subsequent requests on this instance
    await redis.setex(
      REDIS_KEYS.session(sessionId),
      config.security.sessionTtlSeconds,
      JSON.stringify(fromMongo)
    );
    if (fromMongo.userId) {
      await redis.sadd(REDIS_KEYS.userSessions(fromMongo.userId), sessionId);
      await redis.expire(REDIS_KEYS.userSessions(fromMongo.userId), config.security.sessionTtlSeconds);
    }
  }
  return fromMongo;
};

export const deleteSession = async (sessionId) => {
  const redis = getRedisClient();
  const data = await getSession(sessionId);
  await redis.del(REDIS_KEYS.session(sessionId));
  if (data?.userId) {
    await redis.srem(REDIS_KEYS.userSessions(data.userId), sessionId);
  }
  await AuthSession.deleteOne({ sessionId });
};

export const listUserSessions = async (userId, currentSessionId) => {
  const redis = getRedisClient();
  const sessionIds = new Set(await redis.smembers(REDIS_KEYS.userSessions(userId)));

  const mongoRows = await AuthSession.find({
    userId,
    expiresAt: { $gt: new Date() },
  }).lean();
  mongoRows.forEach((r) => sessionIds.add(r.sessionId));

  const sessions = [];
  for (const sid of sessionIds) {
    const sessionData = await getSession(sid);
    if (sessionData) {
      sessions.push({
        sessionId: sid,
        ...sessionData,
        isCurrent: sid === currentSessionId,
      });
    } else {
      await redis.srem(REDIS_KEYS.userSessions(userId), sid);
    }
  }

  return sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

export const revokeOtherUserSessions = async (userId, keepSessionId) => {
  const sessions = await listUserSessions(userId, keepSessionId);
  await Promise.all(
    sessions
      .filter((s) => s.sessionId !== keepSessionId)
      .map((s) => deleteSession(s.sessionId))
  );
  return sessions.filter((s) => s.sessionId !== keepSessionId).length;
};

export const storeRefreshToken = async (tokenId, userId) => {
  const redis = getRedisClient();
  const ttl = config.security.sessionTtlSeconds;
  await redis.setex(REDIS_KEYS.refreshToken(tokenId), ttl, userId.toString());
  await AuthRefreshToken.findOneAndUpdate(
    { jti: tokenId },
    {
      jti: tokenId,
      userId,
      expiresAt: sessionExpiryDate(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

export const isRefreshTokenValid = async (tokenId) => {
  const redis = getRedisClient();
  const inRedis = await redis.exists(REDIS_KEYS.refreshToken(tokenId));
  if (inRedis) return true;
  const row = await AuthRefreshToken.findOne({
    jti: tokenId,
    expiresAt: { $gt: new Date() },
  }).lean();
  return Boolean(row);
};

export const revokeRefreshToken = async (tokenId) => {
  const redis = getRedisClient();
  await redis.del(REDIS_KEYS.refreshToken(tokenId));
  await AuthRefreshToken.deleteOne({ jti: tokenId });
};

export const storeOtp = async (email, otp) => {
  const redis = getRedisClient();
  await redis.setex(REDIS_KEYS.otp(email), config.otp.expirySeconds, otp);
  await redis.del(REDIS_KEYS.otpAttempts(email));
};

export const getOtp = async (email) => {
  const redis = getRedisClient();
  return redis.get(REDIS_KEYS.otp(email));
};

export const deleteOtp = async (email) => {
  const redis = getRedisClient();
  await redis.del(REDIS_KEYS.otp(email));
  await redis.del(REDIS_KEYS.otpAttempts(email));
};

export const incrementOtpAttempts = async (email) => {
  const redis = getRedisClient();
  const key = REDIS_KEYS.otpAttempts(email);
  const attempts = await redis.incr(key);
  if (attempts === 1) {
    await redis.expire(key, config.otp.expirySeconds);
  }
  return attempts;
};

export const getOtpAttempts = async (email) => {
  const redis = getRedisClient();
  const attempts = await redis.get(REDIS_KEYS.otpAttempts(email));
  return parseInt(attempts, 10) || 0;
};

export const getOtpTtl = async (email) => {
  const redis = getRedisClient();
  const ttl = await redis.ttl(REDIS_KEYS.otp(email));
  return ttl > 0 ? ttl : 0;
};

export const getOtpCooldownTtl = async (email) => {
  const redis = getRedisClient();
  const ttl = await redis.ttl(REDIS_KEYS.otpCooldown(email));
  return ttl > 0 ? ttl : 0;
};

export const isOtpCooldownActive = async (email) => {
  const redis = getRedisClient();
  return redis.exists(REDIS_KEYS.otpCooldown(email));
};

export const setOtpCooldown = async (email) => {
  const redis = getRedisClient();
  await redis.setex(REDIS_KEYS.otpCooldown(email), config.otp.resendCooldownSeconds, '1');
};

export const incrementLoginAttempts = async (email) => {
  const redis = getRedisClient();
  const key = REDIS_KEYS.loginAttempts(email);
  const attempts = await redis.incr(key);
  if (attempts === 1) {
    await redis.expire(key, config.security.accountLockDurationSeconds);
  }
  return attempts;
};

export const getLoginAttempts = async (email) => {
  const redis = getRedisClient();
  const attempts = await redis.get(REDIS_KEYS.loginAttempts(email));
  return parseInt(attempts, 10) || 0;
};

export const resetLoginAttempts = async (email) => {
  const redis = getRedisClient();
  await redis.del(REDIS_KEYS.loginAttempts(email));
};

export const setPasswordVerified = async (email, ttlSeconds = 600) => {
  const redis = getRedisClient();
  await redis.setex(REDIS_KEYS.passwordVerified(email.toLowerCase()), ttlSeconds, '1');
};

export const isPasswordVerified = async (email) => {
  const redis = getRedisClient();
  return redis.exists(REDIS_KEYS.passwordVerified(email.toLowerCase()));
};

export const clearPasswordVerified = async (email) => {
  const redis = getRedisClient();
  await redis.del(REDIS_KEYS.passwordVerified(email.toLowerCase()));
};

export const cacheDashboardStats = async (scope, id, data, ttl = 300) => {
  const redis = getRedisClient();
  await redis.setex(REDIS_KEYS.dashboardStats(scope, id), ttl, JSON.stringify(data));
};

export const getCachedDashboardStats = async (scope, id) => {
  const redis = getRedisClient();
  const data = await redis.get(REDIS_KEYS.dashboardStats(scope, id));
  return data ? JSON.parse(data) : null;
};

export const invalidateDashboardCache = async (scope, id) => {
  const redis = getRedisClient();
  await redis.del(REDIS_KEYS.dashboardStats(scope, id));
};

/** Clear all role/scope dashboard snapshots (lead deletes, imports, etc.). */
export const invalidateAllDashboardCaches = async () => {
  const redis = getRedisClient();
  const keys = await redis.keys('dashboard:*');
  if (keys.length) await redis.del(...keys);
};

export const cacheLead = async (id, data, ttl = 600) => {
  const redis = getRedisClient();
  await redis.setex(REDIS_KEYS.leadCache(id), ttl, JSON.stringify(data));
};

export const getCachedLead = async (id) => {
  const redis = getRedisClient();
  const data = await redis.get(REDIS_KEYS.leadCache(id));
  return data ? JSON.parse(data) : null;
};

export const invalidateLeadCache = async (id) => {
  const redis = getRedisClient();
  await redis.del(REDIS_KEYS.leadCache(id));
};
