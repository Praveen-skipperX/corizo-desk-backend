import mongoose from 'mongoose';
import config from './index.js';
import logger from '../utils/logger.js';

export const connectDatabase = async () => {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.mongodbUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    logger.info('MongoDB connected successfully');
  } catch (error) {
    logger.error('MongoDB connection failed:', error);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

export default mongoose;
