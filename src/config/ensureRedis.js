import config from './index.js';
import logger from '../utils/logger.js';
import net from 'net';
import fs from 'fs';
import path from 'path';

const DEV_URL_FILE = path.join(process.cwd(), '.redis-dev-url');

const isRedisReachable = (host, port) =>
  new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port) }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
  });

export const ensureRedis = async () => {
  // Production / Vercel: rely on REDIS_URL (Upstash, Redis Cloud, etc.)
  if (process.env.VERCEL || config.env === 'production') {
    const url = process.env.REDIS_URL || config.redisUrl;
    if (!url || url.includes('localhost') || url.includes('127.0.0.1')) {
      throw new Error('Set REDIS_URL to a hosted Redis instance for production/Vercel');
    }
    process.env.REDIS_URL = url;
    logger.info('Using configured REDIS_URL for production');
    return;
  }

  const reachable = await isRedisReachable('127.0.0.1', 6379);
  if (reachable) {
    logger.info('Redis already running on 127.0.0.1:6379');
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    return;
  }

  if (fs.existsSync(DEV_URL_FILE)) {
    const savedUrl = fs.readFileSync(DEV_URL_FILE, 'utf8').trim();
    try {
      const { hostname, port } = new URL(savedUrl);
      if (await isRedisReachable(hostname, port)) {
        process.env.REDIS_URL = savedUrl;
        logger.info(`Using shared dev Redis at ${savedUrl}`);
        return;
      }
    } catch {
      /* ignore invalid saved url */
    }
  }

  if (config.env === 'development' || config.env === 'test') {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (fs.existsSync(DEV_URL_FILE)) {
        const savedUrl = fs.readFileSync(DEV_URL_FILE, 'utf8').trim();
        try {
          const { hostname, port } = new URL(savedUrl);
          if (await isRedisReachable(hostname, port)) {
            process.env.REDIS_URL = savedUrl;
            logger.info(`Using shared dev Redis at ${savedUrl}`);
            return;
          }
        } catch {
          /* ignore */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    logger.warn('Redis not found — starting in-memory Redis for local development');
    const { RedisMemoryServer } = await import('redis-memory-server');
    const redisServer = new RedisMemoryServer();
    const host = await redisServer.getHost();
    const port = await redisServer.getPort();
    process.env.REDIS_URL = `redis://${host}:${port}`;
    fs.writeFileSync(DEV_URL_FILE, process.env.REDIS_URL);
    logger.info(`In-memory Redis started at ${host}:${port}`);
    return;
  }

  throw new Error('Redis is not running. Start Redis on port 6379 or set REDIS_URL.');
};
