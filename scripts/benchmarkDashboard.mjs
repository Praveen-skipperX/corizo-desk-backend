// Reproducible synthetic benchmark. Never reads MONGODB_URI or production records.
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = 'redis://localhost:6379';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { queryDashboard } from '../src/utils/dashboardQueries.js';
import { getFollowUpDayWindows } from '../src/utils/dateUtils.js';
const { Lead } = await import('../src/models/index.js');
const server = await MongoMemoryServer.create();
try {
  await mongoose.connect(server.getUri(), { dbName: 'synthetic-dashboard-benchmark', maxPoolSize: 5 });
  const { todayStart, todayEnd } = getFollowUpDayWindows();
  const weekStart = new Date(todayStart.getTime() - 6 * 86400000);
  const trendStart = new Date(todayStart.getTime() - 13 * 86400000);
  const filter = { isDeleted: false };
  const date = { $ifNull: ['$leadDate', '$createdAt'] };
  const range = (from) => ({ $expr: { $and: [{ $gte: [date, from] }, { $lte: [date, todayEnd] }] } });
  const statuses = ['new', 'assigned', 'attempted', 'connected', 'interested', 'follow_up', 'closed', 'not_interested', 'duplicate', 'spam'];
  const department = new mongoose.Types.ObjectId();
  const creator = new mongoose.Types.ObjectId();
  const rows = Array.from({ length: 10000 }, (_, i) => ({
    leadId: `SYNTHETIC-${i}`, name: `Synthetic ${i}`, phone: '9000000000', department, createdBy: creator,
    status: statuses[i % statuses.length], priority: ['red', 'yellow', 'green'][i % 3],
    source: ['manual', 'website'][i % 2], course: `Test course ${i % 12}`, isDeleted: i % 31 === 0,
    createdAt: new Date(todayStart.getTime() - (i % 30) * 86400000 + 3600000),
    leadDate: i % 4 ? new Date(todayStart.getTime() - (i % 30) * 86400000 + 3600000) : null,
    nextFollowUpDate: new Date(todayStart.getTime() + ((i % 5) - 2) * 86400000 + 3600000),
  }));
  await Lead.collection.insertMany(rows);
  await Lead.createIndexes();
  const group = (field, extra = {}) => Lead.aggregate([{ $match: { ...filter, ...extra } }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }]);
  const count = (extra = {}) => Lead.countDocuments({ ...filter, ...extra });
  const followUpBase = { status: { $nin: ['closed', 'not_interested', 'duplicate', 'spam'] } };
  // Original controller's seventeen lead operations; the other two operations are unchanged.
  const baseline = () => Promise.all([
    count(), count({ status: { $in: statuses.slice(0, 6) } }), count({ status: 'closed' }), count({ status: 'not_interested' }),
    group('status'), group('priority'), group('department'),
    count({ ...followUpBase, nextFollowUpDate: { $gte: todayStart, $lte: todayEnd } }),
    count({ ...followUpBase, nextFollowUpDate: { $lt: todayStart } }),
    count(range(todayStart)), count(range(weekStart)), count({ status: 'closed', ...range(weekStart) }),
    group('source'), group('course', { course: { $exists: true, $nin: [null, ''] } }), group('course', { status: 'closed', course: { $exists: true, $nin: [null, ''] } }),
    ...[false, true].map((enrolled) => Lead.aggregate([
      { $match: { ...filter, ...range(trendStart), ...(enrolled ? { status: 'closed' } : {}) } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date, timezone: 'Asia/Kolkata' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ])),
  ]);
  const improved = () => queryDashboard(Lead, filter, { todayStart, todayEnd, weekStart, trendStart }, true);
  const old = await baseline();
  const next = (await improved()).summary[0];
  const keys = ['totalLeads', 'openLeads', 'closedWon', 'closedLost', 'todayFollowUps', 'overdueFollowUps', 'todaysLeads', 'weekLeads', 'weekEnrollments'];
  const oldValues = [old[0], old[1], old[2], old[3], old[7], old[8], old[9], old[10], old[11]];
  keys.forEach((key, i) => { if (next[key] !== oldValues[i]) throw new Error(`Metric mismatch: ${key}`); });
  const before = [], after = [];
  for (let i = 0; i < 30; i += 1) {
    let start = performance.now(); await baseline(); before.push(performance.now() - start);
    start = performance.now(); await improved(); after.push(performance.now() - start);
  }
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { p50Ms: Number(sorted[14].toFixed(2)), p95Ms: Number(sorted[28].toFixed(2)), meanMs: Number((values.reduce((a, b) => a + b) / values.length).toFixed(2)) };
  };
  const result = { source: 'Isolated MongoDB; synthetic records; warm queries; no HTTP or cache; unchanged user/activity queries excluded', records: rows.length, samples: 30, maxPoolSize: 5, mongoVersion: server.instanceInfo?.instance?.mongodPath, metricParity: true, before: { leadOperations: 17, ...stats(before) }, after: { leadOperations: 8, ...stats(after) } };
  delete result.mongoVersion;
  await writeFile(new URL('../docs/dashboard-benchmark.json', import.meta.url), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await mongoose.disconnect(); await server.stop(); }
