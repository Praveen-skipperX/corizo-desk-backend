import { Worker } from 'bullmq';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { QUEUE_NAMES } from '../queues/index.js';
import {
  sendOtpEmail,
  sendAccountLockedEmail,
  sendFollowUpReminderEmail,
  sendLeadAssignedEmail,
  sendAccountCreatedEmail,
  sendEmail,
} from '../services/emailService.js';
import { FollowUp, ImportHistory, Lead } from '../models/index.js';
import { FOLLOW_UP_STATUSES, LEAD_SOURCES, LEAD_STATUSES } from '../constants/index.js';
import { generateLeadId } from '../utils/helpers.js';
import ExcelJS from 'exceljs';
import fs from 'fs/promises';

export default function startWorkerProcesses() {
  startEmailWorker();
  startImportWorker();
  startFollowUpWorker();
  startConnectorSyncWorker();
}

export function startEmailWorker() {
  const connection = { url: process.env.REDIS_URL || config.redisUrl };

  const emailWorker = new Worker(
    QUEUE_NAMES.EMAIL,
    async (job) => {
      const { type, ...data } = job.data;
      switch (type) {
        case 'otp':
          return sendOtpEmail(data.email, data.otp, data.name);
        case 'account_locked':
          return sendAccountLockedEmail(data.email, data.name);
        case 'follow_up_reminder':
          return sendFollowUpReminderEmail(data.email, data.name, data.followUps);
        case 'lead_assigned':
          return sendLeadAssignedEmail(data.email, data.name, data.lead);
        case 'account_created':
          return sendAccountCreatedEmail(data);
        default:
          return sendEmail(data);
      }
    },
    { connection, concurrency: 5 }
  );

  emailWorker.on('completed', (job) => logger.info(`Email job ${job.id} completed`));
  emailWorker.on('failed', (job, err) => logger.error(`Email job ${job?.id} failed:`, err));

  return emailWorker;
}

function startImportWorker() {
  const connection = { url: process.env.REDIS_URL || config.redisUrl };

  const importWorker = new Worker(
    QUEUE_NAMES.IMPORT,
    async (job) => {
      const { importHistoryId, filePath, userId, departmentId } = job.data;
      const importHistory = await ImportHistory.findById(importHistoryId);
      if (!importHistory) throw new Error('Import history not found');

      importHistory.status = 'processing';
      importHistory.startedAt = new Date();
      await importHistory.save();

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.worksheets[0];
      const errors = [];
      let successCount = 0;
      let duplicateCount = 0;
      let totalRows = 0;

      const headers = {};
      worksheet.getRow(1).eachCell((cell, colNumber) => {
        headers[colNumber] = cell.value?.toString().toLowerCase().trim();
      });

      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        if (!row.hasValues) continue;
        totalRows++;

        const getVal = (key) => {
          const col = Object.entries(headers).find(([, v]) => v.includes(key))?.[0];
          return col ? row.getCell(parseInt(col, 10)).value?.toString()?.trim() : '';
        };

        const name = getVal('customer') || getVal('name');
        const phone = getVal('phone');
        const email = getVal('email');

        if (!name || !phone) {
          errors.push({ row: rowNumber, field: 'required', message: 'Name and phone are required' });
          continue;
        }

        const duplicateHash = `${phone}-${email}`.toLowerCase();
        const existing = await Lead.findOne({ duplicateHash, isDeleted: false });
        if (existing) {
          duplicateCount++;
          continue;
        }

        try {
          const leadId = await generateLeadId(Lead);
          await Lead.create({
            leadId,
            name,
            email,
            phone,
            address: {
              street: getVal('address') || getVal('street'),
              city: getVal('city'),
              state: getVal('state'),
              pincode: getVal('pincode') || getVal('zip'),
            },
            source: LEAD_SOURCES.MANUAL,
            department: departmentId,
            createdBy: userId,
            status: LEAD_STATUSES.NEW,
            duplicateHash,
          });
          successCount++;
        } catch (err) {
          errors.push({ row: rowNumber, field: 'general', message: err.message });
        }
      }

      importHistory.totalRows = totalRows;
      importHistory.successCount = successCount;
      importHistory.failureCount = errors.length;
      importHistory.duplicateCount = duplicateCount;
      importHistory.errors = errors;
      importHistory.status = errors.length === totalRows ? 'failed' : errors.length > 0 ? 'partial' : 'completed';
      importHistory.completedAt = new Date();
      await importHistory.save();

      try {
        await fs.unlink(filePath);
      } catch {
        /* ignore */
      }

      return { successCount, duplicateCount, errors: errors.length };
    },
    { connection, concurrency: 2 }
  );

  importWorker.on('completed', (job) => logger.info(`Import job ${job.id} completed`));
  importWorker.on('failed', (job, err) => logger.error(`Import job ${job?.id} failed:`, err));

  return importWorker;
}

function startFollowUpWorker() {
  const connection = { url: process.env.REDIS_URL || config.redisUrl };

  const followUpWorker = new Worker(
    QUEUE_NAMES.FOLLOW_UP,
    async (job) => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);

      if (job.name === 'follow-up-reminders') {
        const followUps = await FollowUp.find({
          status: FOLLOW_UP_STATUSES.SCHEDULED,
          scheduledDate: { $gte: now, $lte: tomorrow },
          reminderSent: false,
        }).populate('assignedTo lead');

        const byUser = {};
        for (const fu of followUps) {
          const userId = fu.assignedTo._id.toString();
          if (!byUser[userId]) byUser[userId] = { user: fu.assignedTo, followUps: [] };
          byUser[userId].followUps.push({
            name: fu.lead?.name,
            scheduledDate: fu.scheduledDate,
          });
        }

        for (const { user, followUps: userFollowUps } of Object.values(byUser)) {
          await sendFollowUpReminderEmail(user.email, user.name, userFollowUps);
          await FollowUp.updateMany(
            { _id: { $in: followUps.filter((f) => f.assignedTo._id.toString() === user._id.toString()).map((f) => f._id) } },
            { reminderSent: true }
          );
        }
      }

      if (job.name === 'overdue-follow-ups') {
        const overdue = await FollowUp.find({
          status: FOLLOW_UP_STATUSES.SCHEDULED,
          scheduledDate: { $lt: now },
          overdueNotified: false,
        }).populate('assignedTo lead');

        await FollowUp.updateMany(
          { _id: { $in: overdue.map((f) => f._id) } },
          { status: FOLLOW_UP_STATUSES.OVERDUE }
        );

        for (const fu of overdue) {
          if (fu.assignedTo?.email) {
            await sendEmail({
              to: fu.assignedTo.email,
              subject: `Overdue Follow-up: ${fu.lead?.name}`,
              html: `<p>You have an overdue follow-up for ${fu.lead?.name} scheduled on ${fu.scheduledDate}.</p>`,
            });
          }
        }

        await FollowUp.updateMany(
          { _id: { $in: overdue.map((f) => f._id) } },
          { overdueNotified: true }
        );
      }
    },
    { connection, concurrency: 1 }
  );

  followUpWorker.on('completed', (job) => logger.info(`Follow-up job ${job.id} completed`));
  followUpWorker.on('failed', (job, err) => logger.error(`Follow-up job ${job?.id} failed:`, err));

  return followUpWorker;
}

export function startConnectorSyncWorker() {
  const connection = { url: process.env.REDIS_URL || config.redisUrl };

  const markSyncFailed = async (syncLogId, message) => {
    if (!syncLogId) return;
    try {
      const { ConnectorSyncLog } = await import('../models/index.js');
      await ConnectorSyncLog.findByIdAndUpdate(syncLogId, {
        status: 'failed',
        phase: 'done',
        completedAt: new Date(),
        errorSummary: String(message || 'Sync failed').slice(0, 500),
      });
    } catch (err) {
      logger.error('Failed to mark sync log as failed:', err);
    }
  };

  const worker = new Worker(
    QUEUE_NAMES.CONNECTOR_SYNC,
    async (job) => {
      const { connectorId, userId, triggeredBy = 'schedule', syncLogId } = job.data;
      const { Connector, User } = await import('../models/index.js');
      const { commitConnectorImport } = await import('../services/leadImportService.js');

      const connector = await Connector.findById(connectorId);
      if (!connector || connector.isDeleted || connector.status === 'disabled') {
        logger.warn(`Skipping sync for connector ${connectorId}`);
        await markSyncFailed(syncLogId, 'Connector unavailable or disabled');
        return { skipped: true };
      }

      const user = userId ? await User.findById(userId) : null;
      try {
        return await commitConnectorImport({
          connector,
          user,
          mode: 'sync',
          triggeredBy,
          syncLogId: syncLogId || null,
          jobId: job.id,
        });
      } catch (err) {
        await markSyncFailed(syncLogId, err.message || 'Background sync failed');
        throw err;
      }
    },
    {
      connection,
      concurrency: 1,
      // Large sheets can take a while; fail loudly if locked too long
      lockDuration: 15 * 60 * 1000,
    }
  );

  worker.on('completed', (job) => logger.info(`Connector sync job ${job.id} completed`));
  worker.on('failed', async (job, err) => {
    logger.error(`Connector sync job ${job?.id} failed:`, err);
    await markSyncFailed(job?.data?.syncLogId, err?.message || 'Background sync failed');
  });

  return worker;
}
