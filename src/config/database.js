import mongoose from 'mongoose';
import config from './index.js';
import logger from '../utils/logger.js';

export const connectDatabase = async () => {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.mongodbUri, {
      maxPoolSize: process.env.VERCEL ? 5 : 10,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 45000,
    });
    logger.info('MongoDB connected successfully');
  } catch (error) {
    logger.error('MongoDB connection failed:', error);
    // Don't kill the Vercel isolate — surface the error to the request handler
    if (process.env.VERCEL) throw error;
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

export default mongoose;
