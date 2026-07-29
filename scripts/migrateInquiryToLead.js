/**
 * Migration script: Inquiry domain → Lead domain
 *
 * Renames MongoDB collections and fields from the legacy Inquiry model to Lead.
 * Does NOT run automatically — execute manually against a target database after backup.
 *
 * Usage:
 *   node backend/scripts/migrateInquiryToLead.js
 *
 * Environment:
 *   MONGODB_URI — connection string (uses same config as the app if unset)
 *
 * What it does:
 *  1. Renames `inquiries` collection → `leads` (if inquiries exists and leads does not)
 *  2. Renames fields on lead documents: inquiryId→leadId, customerName→name
 *  3. Maps legacy status values to new LEAD_STATUSES
 *  4. Renames `inquiry` refs → `lead` in related collections
 *  5. Renames inquiryassignments → leadassignments and inquiry→lead field
 *  6. Updates dealclosures: inquiry→lead, inquiryRef→leadRef, customerName→name
 */

import mongoose from 'mongoose';
import config from '../src/config/index.js';

const STATUS_MAP = {
  new: 'new',
  contacted: 'connected',
  follow_up_pending: 'follow_up',
  in_progress: 'interested',
  closed_won: 'closed',
  closed_lost: 'not_interested',
};

const SOURCE_MAP = {
  website: 'website',
  manual: 'manual',
  excel: 'manual',
  api: 'manual',
  phone: 'whatsapp',
  email: 'manual',
  referral: 'referral',
};

const RELATED_COLLECTIONS = [
  'followups',
  'creatorremarks',
  'adminremarks',
  'superadminremarks',
  'remarks',
];

const renameField = async (db, collection, from, to) => {
  const result = await db.collection(collection).updateMany(
    { [from]: { $exists: true } },
    { $rename: { [from]: to } }
  );
  if (result.modifiedCount > 0) {
    console.log(`  ${collection}: renamed ${from} → ${to} (${result.modifiedCount} docs)`);
  }
};

const migrateStatuses = async (db, collection) => {
  for (const [oldStatus, newStatus] of Object.entries(STATUS_MAP)) {
    const result = await db.collection(collection).updateMany(
      { status: oldStatus },
      { $set: { status: newStatus } }
    );
    if (result.modifiedCount > 0) {
      console.log(`  ${collection}: status ${oldStatus} → ${newStatus} (${result.modifiedCount} docs)`);
    }
  }
};

const migrateSources = async (db, collection) => {
  for (const [oldSource, newSource] of Object.entries(SOURCE_MAP)) {
    const result = await db.collection(collection).updateMany(
      { source: oldSource },
      { $set: { source: newSource } }
    );
    if (result.modifiedCount > 0) {
      console.log(`  ${collection}: source ${oldSource} → ${newSource} (${result.modifiedCount} docs)`);
    }
  }
};

const migrateLeadIds = async (db) => {
  const leads = db.collection('leads');
  const cursor = leads.find({ inquiryId: { $exists: true } });
  let count = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const leadId = doc.inquiryId?.startsWith('INQ-')
      ? doc.inquiryId.replace(/^INQ-/, 'LEAD-')
      : doc.inquiryId;
    await leads.updateOne(
      { _id: doc._id },
      {
        $set: { leadId },
        $unset: { inquiryId: '' },
      }
    );
    count++;
  }
  if (count > 0) console.log(`  leads: migrated inquiryId → leadId (${count} docs)`);
};

const migrateNames = async (db) => {
  const result = await db.collection('leads').updateMany(
    { customerName: { $exists: true } },
    { $rename: { customerName: 'name' } }
  );
  if (result.modifiedCount > 0) {
    console.log(`  leads: renamed customerName → name (${result.modifiedCount} docs)`);
  }
};

async function main() {
  const uri = process.env.MONGODB_URI || config.mongodbUri;
  console.log('Connecting to MongoDB...');
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const collections = (await db.listCollections().toArray()).map((c) => c.name);

  if (collections.includes('inquiries') && !collections.includes('leads')) {
    console.log('Renaming collection inquiries → leads');
    await db.collection('inquiries').rename('leads');
  } else if (collections.includes('inquiries') && collections.includes('leads')) {
    console.warn('Both inquiries and leads collections exist — skipping collection rename. Merge manually if needed.');
  } else if (collections.includes('leads')) {
    console.log('leads collection already exists — skipping collection rename');
  } else {
    console.log('No inquiries or leads collection found — nothing to migrate');
    await mongoose.disconnect();
    return;
  }

  console.log('Migrating lead document fields...');
  await migrateLeadIds(db);
  await migrateNames(db);
  await migrateStatuses(db, 'leads');
  await migrateSources(db, 'leads');

  console.log('Migrating related collection refs...');
  for (const col of RELATED_COLLECTIONS) {
    if (collections.includes(col) || (await db.listCollections({ name: col }).hasNext())) {
      await renameField(db, col, 'inquiry', 'lead');
    }
  }

  if (collections.includes('inquiryassignments') && !collections.includes('leadassignments')) {
    console.log('Renaming collection inquiryassignments → leadassignments');
    await db.collection('inquiryassignments').rename('leadassignments');
  }
  if ((await db.listCollections({ name: 'leadassignments' }).hasNext())) {
    await renameField(db, 'leadassignments', 'inquiry', 'lead');
  }

  if (await db.listCollections({ name: 'dealclosures' }).hasNext()) {
    await renameField(db, 'dealclosures', 'inquiry', 'lead');
    await renameField(db, 'dealclosures', 'inquiryRef', 'leadRef');
    const nameResult = await db.collection('dealclosures').updateMany(
      { customerName: { $exists: true } },
      { $rename: { customerName: 'name' } }
    );
    if (nameResult.modifiedCount > 0) {
      console.log(`  dealclosures: renamed customerName → name (${nameResult.modifiedCount} docs)`);
    }
  }

  const activityResult = await db.collection('activitylogs').updateMany(
    { 'metadata.inquiryId': { $exists: true } },
    [{ $set: { 'metadata.leadId': '$metadata.inquiryId' }, $unset: ['metadata.inquiryId'] }]
  );
  if (activityResult.modifiedCount > 0) {
    console.log(`  activitylogs: metadata.inquiryId → leadId (${activityResult.modifiedCount} docs)`);
  }

  const entityResult = await db.collection('activitylogs').updateMany(
    { entityType: 'inquiry' },
    { $set: { entityType: 'lead' } }
  );
  if (entityResult.modifiedCount > 0) {
    console.log(`  activitylogs: entityType inquiry → lead (${entityResult.modifiedCount} docs)`);
  }

  console.log('Migration complete.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
