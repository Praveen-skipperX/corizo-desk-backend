/**
 * One-time backfill: set leadDate from customFields / originalRow / createdAt.
 * Usage: node scripts/backfill-lead-dates.mjs
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { resolveLeadDate } from '../src/utils/leadDate.js';

dotenv.config();

await mongoose.connect(process.env.MONGODB_URI);
const Lead = mongoose.connection.collection('leads');

const cursor = Lead.find({ isDeleted: false });
let updated = 0;
let scanned = 0;
const ops = [];

while (await cursor.hasNext()) {
  const lead = await cursor.next();
  scanned += 1;
  const resolved = resolveLeadDate(lead);
  if (!resolved) continue;
  const current = lead.leadDate ? new Date(lead.leadDate).getTime() : null;
  if (current === resolved.getTime()) continue;

  ops.push({
    updateOne: {
      filter: { _id: lead._id },
      update: { $set: { leadDate: resolved } },
    },
  });

  if (ops.length >= 500) {
    await Lead.bulkWrite(ops);
    updated += ops.length;
    ops.length = 0;
    process.stdout.write(`\rscanned ${scanned}, updated ${updated}`);
  }
}

if (ops.length) {
  await Lead.bulkWrite(ops);
  updated += ops.length;
}

console.log(`\nDone. scanned=${scanned} updated=${updated}`);
await mongoose.disconnect();
