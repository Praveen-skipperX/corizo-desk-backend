export default async function handler(req, res) {
  const origin = req.headers?.origin || '';
  if (
    origin === 'https://desk.corizo.in'
    || origin.startsWith('http://localhost:')
    || origin.endsWith('.vercel.app')
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const mongoose = (await import('mongoose')).default;
    const { default: config } = await import('../src/config/index.js');
    const { getRedisClient } = await import('../src/config/redis.js');
    const { default: logger } = await import('../src/utils/logger.js');

    if (!config.mongodbUri) {
      res.status(500).json({
        success: false,
        code: 'MISSING_MONGODB_URI',
        message: 'Set MONGODB_URI in Vercel Environment Variables',
      });
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

    const path = req.url || '';
    if (path === '/api/health' || path === '/health' || path.startsWith('/api/health?')) {
      res.status(200).json({
        success: true,
        message: 'Corizo Desk API is running',
        mongo: 'connected',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { default: app } = await import('../src/app.js');
    return app(req, res);
  } catch (err) {
    console.error('API handler failed:', err);
    res.status(500).json({
      success: false,
      code: 'BOOTSTRAP_FAILED',
      message: err?.message || 'Server failed to start',
    });
  }
}
