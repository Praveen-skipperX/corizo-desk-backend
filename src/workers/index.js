import config from '../config/index.js';
import { connectDatabase } from '../config/database.js';
import { ensureRedis } from '../config/ensureRedis.js';
import logger from '../utils/logger.js';

const startWorkers = async () => {
  await ensureRedis();
  await connectDatabase();

  const { default: startWorkerProcesses } = await import('./workerProcesses.js');
  startWorkerProcesses();
  logger.info('BullMQ workers started');
};

startWorkers().catch((error) => {
  logger.error('Failed to start workers:', error);
  process.exit(1);
});
