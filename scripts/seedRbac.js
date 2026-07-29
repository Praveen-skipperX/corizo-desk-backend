import mongoose from 'mongoose';
import dotenv from 'dotenv';
import config from '../src/config/index.js';
import { seedRbac } from '../src/services/permissionService.js';
import logger from '../src/utils/logger.js';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI || config.mongodbUri;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const result = await seedRbac();
  console.log('RBAC seed OK:', result);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.error('RBAC seed failed', err);
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
