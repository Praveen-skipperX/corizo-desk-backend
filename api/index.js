import mongoose from 'mongoose';
import config from '../src/config/index.js';
import { getRedisClient } from '../src/config/redis.js';
import logger from '../src/utils/logger.js';
import app from '../src/app.js';

let readyPromise = null;

const applyCorsHeaders = (req, res) => {
  const origin = req.headers?.origin;
  if (origin && config.frontendOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
};

async function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (!config.mongodbUri) {
        throw new Error('MONGODB_URI is not configured');
      }
      if (!process.env.REDIS_URL && (!config.redisUrl || config.redisUrl.includes('localhost'))) {
        throw new Error('REDIS_URL must be set to a reachable Redis (e.g. Upstash) on Vercel');
      }

      if (mongoose.connection.readyState !== 1) {
        mongoose.set('strictQuery', true);
        await mongoose.connect(config.mongodbUri, {
          maxPoolSize: 5,
          serverSelectionTimeoutMS: 8000,
          socketTimeoutMS: 45000,
        });
        logger.info('MongoDB connected (serverless)');
      }

      // Touch Redis so auth/session/rate-limit stores are ready
      const redis = getRedisClient();
      await redis.ping();
      logger.info('Redis ready (serverless)');
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

export default async function handler(req, res) {
  // Answer CORS preflight even if bootstrap fails later
  if (req.method === 'OPTIONS') {
    applyCorsHeaders(req, res);
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    await ensureReady();
  } catch (err) {
    logger.error('Serverless bootstrap failed:', err);
    applyCorsHeaders(req, res);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: false,
        message: err.message || 'Server failed to start',
        code: 'BOOTSTRAP_FAILED',
      })
    );
    return;
  }

  return app(req, res);
}
