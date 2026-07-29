import { Queue } from 'bullmq';
import config from '../config/index.js';

const getConnection = () => ({ url: process.env.REDIS_URL || config.redisUrl });

export const QUEUE_NAMES = {
  EMAIL: 'email-queue',
  IMPORT: 'import-queue',
  FOLLOW_UP: 'follow-up-queue',
  REPORT: 'report-queue',
  CONNECTOR_SYNC: 'connector-sync-queue',
};

export const emailQueue = new Queue(QUEUE_NAMES.EMAIL, { connection: getConnection() });
export const importQueue = new Queue(QUEUE_NAMES.IMPORT, { connection: getConnection() });
export const followUpQueue = new Queue(QUEUE_NAMES.FOLLOW_UP, { connection: getConnection() });
export const reportQueue = new Queue(QUEUE_NAMES.REPORT, { connection: getConnection() });
export const connectorSyncQueue = new Queue(QUEUE_NAMES.CONNECTOR_SYNC, { connection: getConnection() });

export const addEmailJob = (data, options = {}) =>
  emailQueue.add('send-email', data, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, ...options });

export const addImportJob = (data) =>
  importQueue.add('process-import', data, { attempts: 2, backoff: { type: 'fixed', delay: 5000 } });

export const addFollowUpReminderJob = () =>
  followUpQueue.add('follow-up-reminders', {}, { repeat: { pattern: '0 8 * * *' } });

export const addOverdueFollowUpJob = () =>
  followUpQueue.add('overdue-follow-ups', {}, { repeat: { pattern: '0 9,14 * * *' } });

export const addReportJob = (data) =>
  reportQueue.add('generate-report', data, { attempts: 2 });

export const addConnectorSyncJob = (data, options = {}) =>
  connectorSyncQueue.add('sync-connector', data, {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
    ...options,
  });

export const scheduleRecurringJobs = async () => {
  await addFollowUpReminderJob();
  await addOverdueFollowUpJob();
};
