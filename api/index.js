import mongoose from 'mongoose';

const ALLOWED_ORIGINS = new Set([
  'https://desk.corizo.in',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const applyCors = (req, res) => {
  const origin = req.headers?.origin;
  if (origin && (ALLOWED_ORIGINS.has(origin) || origin.endsWith('.vercel.app'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

let readyPromise = null;
let appPromise = null;

async function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      // Load env/config after Vercel injects env
      const { default: config } = await import('../src/config/index.js');
      const { getRedisClient } = await import('../src/config/redis.js');
      const logger = (await import('../src/utils/logger.js')).default;

      if (!config.mongodbUri) {
        throw new Error('MONGODB_URI is not configured on Vercel');
      }
      if (!config.jwt?.accessSecret || config.jwt.accessSecret.includes('change')) {
        logger.warn('JWT_ACCESS_SECRET looks unset/weak — set a strong secret on Vercel');
      }

      if (mongoose.connection.readyState !== 1) {
        mongoose.set('strictQuery', true);
        await mongoose.connect(config.mongodbUri, {
          maxPoolSize: 5,
          serverSelectionTimeoutMS: 10000,
          socketTimeoutMS: 45000,
        });
        logger.info('MongoDB connected (serverless)');
      }

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

async function getApp() {
  if (!appPromise) {
    appPromise = import('../src/app.js').then((m) => m.default);
  }
  return appPromise;
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Lightweight health that does not require full app boot
  if (req.url === '/api/health' || req.url === '/health') {
    try {
      await ensureReady();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: true,
          message: 'Corizo Desk API is running',
          mongo: mongoose.connection.readyState === 1 ? 'connected' : 'pending',
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: false,
          message: err.message || 'Bootstrap failed',
          code: 'BOOTSTRAP_FAILED',
        })
      );
    }
    return;
  }

  try {
    await ensureReady();
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    console.error('Serverless handler error:', err);
    applyCors(req, res);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: false,
        message: err.message || 'Server failed to start',
        code: 'BOOTSTRAP_FAILED',
      })
    );
  }
}
