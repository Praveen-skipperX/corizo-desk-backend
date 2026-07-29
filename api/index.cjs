module.exports = async function handler(req, res) {
  try {
    const origin = (req.headers && req.headers.origin) || '';
    if (
      origin === 'https://desk.corizo.in'
      || origin.indexOf('http://localhost:') === 0
      || origin.indexOf('http://127.0.0.1:') === 0
      || origin.indexOf('.vercel.app') !== -1
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const mongoose = (await import('mongoose')).default;
    const { default: config } = await import('../src/config/index.js');
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
      await mongoose.connect(config.mongodbUri, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 10000,
      });
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
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: true,
        message: 'Corizo Desk API is running',
        mongo: mongoose.connection.readyState === 1 ? 'connected' : 'pending',
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    const { default: app } = await import('../src/app.js');
    return app(req, res);
  } catch (err) {
    console.error('API handler failed:', err);
    const origin = (req.headers && req.headers.origin) || '';
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      code: 'BOOTSTRAP_FAILED',
      message: (err && err.message) || 'Server failed to start',
    }));
  }
};
