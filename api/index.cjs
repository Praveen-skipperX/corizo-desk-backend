let connectionPromise;

module.exports = async function handler(req, res) {
  try {
    const { default: config } = await import('../src/config/index.js');
    const origin = req.headers?.origin;
    res.setHeader('Cache-Control', 'private, no-store');
    if (origin && config.frontendOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (origin && !config.frontendOrigins.includes(origin)) {
      res.statusCode = 403;
      res.end(JSON.stringify({ success: false, message: 'Origin not allowed' }));
      return;
    }
    if (process.env.VERCEL_ENV === 'preview' && process.env.PREVIEW_DATA_ISOLATED !== 'true') {
      res.statusCode = 503;
      res.end(JSON.stringify({ success: false, message: 'Preview database isolation must be confirmed' }));
      return;
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.statusCode = 204;
      res.end();
      return;
    }

    const mongoose = (await import('mongoose')).default;
    const { getRedisClient } = await import('../src/config/redis.js');
    const { default: logger } = await import('../src/utils/logger.js');

    if (!config.mongodbUri) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        code: 'MISSING_MONGODB_URI',
        message: 'Set MONGODB_URI in Vercel Environment Variables',
      }));
      return;
    }

    if (mongoose.connection.readyState !== 1) {
      mongoose.set('strictQuery', true);
      connectionPromise ||= mongoose.connect(config.mongodbUri, {
        maxPoolSize: 5,
        autoIndex: config.env !== 'production',
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      }).finally(() => { connectionPromise = null; });
      await connectionPromise;
      logger.info('MongoDB connected (serverless)');
    }

    await getRedisClient().ping();

    const url = req.url || '';
    if (
      url === '/'
      || url === '/api'
      || url === '/api/health'
      || url.indexOf('/api/health?') === 0
      || url === '/health'
    ) {
      const { getCacheBackendInfo } = await import('../src/services/redisService.js');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: true,
        message: 'Corizo Desk API is running',
        mongo: mongoose.connection.readyState === 1 ? 'connected' : 'pending',
        cache: getCacheBackendInfo(),
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    const { default: app } = await import('../src/app.js');
    return app(req, res);
  } catch (err) {
    console.error('API handler failed:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      code: 'BOOTSTRAP_FAILED',
      message: 'Service temporarily unavailable',
    }));
  }
};
