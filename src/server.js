import config from './config/index.js';
import { connectDatabase } from './config/database.js';
import { ensureRedis } from './config/ensureRedis.js';
import logger from './utils/logger.js';
import fs from 'fs/promises';

const startServer = async () => {
  try {
    await ensureRedis();
    await connectDatabase();

    const { getRedisClient } = await import('./config/redis.js');
    getRedisClient();

    const { default: app } = await import('./app.js');

    try {
      await fs.mkdir('uploads', { recursive: true });
    } catch {
      /* ignore */
    }

    if (config.env !== 'test') {
      try {
        const { scheduleRecurringJobs } = await import('./queues/index.js');
        await scheduleRecurringJobs();
        logger.info('BullMQ recurring jobs scheduled');
      } catch (error) {
        logger.warn('BullMQ jobs not scheduled:', error.message);
      }

      try {
        const { startEmailWorker, startConnectorSyncWorker } = await import('./workers/workerProcesses.js');
        startEmailWorker();
        startConnectorSyncWorker();
        logger.info('Email + connector sync workers started (background jobs)');
      } catch (error) {
        logger.warn('Background workers not started:', error.message);
      }
    }

    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port} in ${config.env} mode`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
