// Explicit schema index provisioning; does not delete indexes or edit records.
import config from '../src/config/index.js';
import mongoose from 'mongoose';
import * as models from '../src/models/index.js';

if (!process.argv.includes('--confirm-index-build')) throw new Error('Review the target database, then pass --confirm-index-build');
if (!config.mongodbUri) throw new Error('MONGODB_URI is required');
try {
  await mongoose.connect(config.mongodbUri, { autoIndex: false, maxPoolSize: 2 });
  for (const [name, model] of Object.entries(models)) {
    if (model?.createIndexes) { await model.createIndexes(); console.log(`Created declared indexes for ${name}`); }
  }
} finally { await mongoose.disconnect(); }
