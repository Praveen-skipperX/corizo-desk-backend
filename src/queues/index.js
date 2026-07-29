import { Queue } from 'bullmq';
import config from '../config/index.js';
import { hasHostedRedis } from '../config/redis.js';

const getConnection = () => ({ url: process.env.REDIS_URL || config.redisUrl });

export const QUEUE_NAMES = {
  EMAIL: 'email-queue',
  IMPORT: 'import-queue',
  FOLLOW_UP: 'follow-up-queue',
  REPORT: 'report-queue',
  CONNECTOR_SYNC: 'connector-sync-queue',
};

/** Lazy queues — avoid BullMQ connecting to localhost on Vercel cold starts. */
const queueCache = new Map();

const getQueue = (name) => {
  if (!hasHostedRedis()) {
    throw new Error(
      'Background queues require a hosted REDIS_URL. Set REDIS_URL or use inline sync on Vercel.'
    );
  }
  if (!queueCache.has(name)) {
    queueCache.set(name, new Queue(name, { connection: getConnection() }));
  }
  return queueCache.get(name);
};

export const getEmailQueue = () => getQueue(QUEUE_NAMES.EMAIL);
export const getImportQueue = () => getQueue(QUEUE_NAMES.IMPORT);
export const getFollowUpQueue = () => getQueue(QUEUE_NAMES.FOLLOW_UP);
export const getReportQueue = () => getQueue(QUEUE_NAMES.REPORT);
export const getConnectorSyncQueue = () => getQueue(QUEUE_NAMES.CONNECTOR_SYNC);

// Back-compat getters used by some imports (lazy)
export const emailQueue = { add: (...args) => getEmailQueue().add(...args) };
export const importQueue = { add: (...args) => getImportQueue().add(...args) };
export const followUpQueue = { add: (...args) => getFollowUpQueue().add(...args) };
export const reportQueue = { add: (...args) => getReportQueue().add(...args) };
export const connectorSyncQueue = { add: (...args) => getConnectorSyncQueue().add(...args) };

export const addEmailJob = (data, options = {}) =>
  getEmailQueue().add('send-email', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    ...options,
  });

export const addImportJob = (data) =>
  getImportQueue().add('process-import', data, {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
  });

export const addFollowUpReminderJob = () =>
  getFollowUpQueue().add('follow-up-reminders', {}, { repeat: { pattern: '0 8 * * *' } });

export const addOverdueFollowUpJob = () =>
  getFollowUpQueue().add('overdue-follow-ups', {}, { repeat: { pattern: '0 9,14 * * *' } });

export const addReportJob = (data) =>
  getReportQueue().add('generate-report', data, { attempts: 2 });

export const addConnectorSyncJob = (data, options = {}) =>
  getConnectorSyncQueue().add('sync-connector', data, {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
    ...options,
  });

export const scheduleRecurringJobs = async () => {
  if (!hasHostedRedis()) return;
  await addFollowUpReminderJob();
  await addOverdueFollowUpJob();
};
