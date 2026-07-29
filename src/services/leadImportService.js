import { getAdapter } from '../connectors/index.js';
import { buildDuplicateIndex, findDuplicateInIndex, buildDuplicateHash } from './duplicateDetectionService.js';
import {
  Lead,
  Connector,
  ConnectorSyncLog,
  LeadTimelineEvent,
} from '../models/index.js';
import {
  SYNC_MODES,
  TIMELINE_EVENT_TYPES,
  CONNECTOR_STATUSES,
  CONNECTOR_HEALTH,
  LEAD_STATUSES,
  LEAD_PRIORITIES,
  ACTIVITY_ACTIONS,
  ENTITY_TYPES,
} from '../constants/index.js';
import { generateLeadId } from '../utils/helpers.js';
import { pickPersistableLeadFields, mergeCustomFields } from '../utils/customFields.js';
import { resolveLeadDate } from '../utils/leadDate.js';
import { logActivity } from './auditService.js';
import logger from '../utils/logger.js';

const addTimelineEvent = async ({ leadId, type, title, description, actor, actorName, metadata }) => {
  await LeadTimelineEvent.create({
    lead: leadId,
    type,
    title,
    description,
    actor,
    actorName,
    metadata,
  });
};

const classifyRows = async ({ rows, connector, adapter, onProgress }) => {
  const classified = {
    rowsFound: rows.length,
    newRows: [],
    duplicateRows: [],
    invalidRows: [],
    skippedRows: [],
  };

  const duplicateIndex = await buildDuplicateIndex({
    duplicateRule: connector.duplicateRule,
    departmentId: connector.department,
  });

  let index = 0;
  for (const row of rows) {
    const { leadFields, errors, raw } = adapter.normalizeRow(row, connector.fieldMapping || []);
    const rowKey = adapter.getRowIdentity(row, connector);

    if (!leadFields.name && !leadFields.phone && !leadFields.email) {
      classified.skippedRows.push({ row: raw, reason: 'Empty row' });
    } else {
      const rowErrors = [...errors];
      if (!leadFields.phone) {
        rowErrors.push({ field: 'phone', message: 'Phone is required' });
      }
      if (!leadFields.name) {
        rowErrors.push({ field: 'name', message: 'Name is required' });
      }

      if (rowErrors.length) {
        classified.invalidRows.push({ row: raw, leadFields, errors: rowErrors, rowKey });
      } else {
        if (rowKey) leadFields._rowKey = rowKey;

        const duplicate = findDuplicateInIndex(duplicateIndex, leadFields);

        if (duplicate) {
          classified.duplicateRows.push({
            row: raw,
            leadFields,
            rowKey,
            existingLeadId: duplicate._id,
            existingLeadCode: duplicate.leadId,
          });
        } else {
          classified.newRows.push({ row: raw, leadFields, rowKey });
          // Prevent within-sheet duplicates from all inserting
          const phone = String(leadFields.phone || '').replace(/\D/g, '').replace(/^91/, '').slice(-10);
          const email = String(leadFields.email || '').trim().toLowerCase();
          if (phone) duplicateIndex.byPhone.set(phone, { _id: 'pending', leadId: 'pending' });
          if (email) duplicateIndex.byEmail.set(email, { _id: 'pending', leadId: 'pending' });
          if (rowKey) duplicateIndex.byRowKey.set(String(rowKey), { _id: 'pending', leadId: 'pending' });
        }
      }
    }

    index += 1;
    if (typeof onProgress === 'function' && (index % 50 === 0 || index === rows.length)) {
      await onProgress({ processed: index, total: rows.length });
    }
  }

  return classified;
};

/**
 * Dry-run import classification without writing leads.
 */
export const previewConnectorImport = async ({ connector, user }) => {
  const adapter = getAdapter(connector.type);
  const startedAt = new Date();

  const { rows, headers, meta } = await adapter.fetchRows(connector);
  const classified = await classifyRows({ rows, connector, adapter });

  const preview = {
    headers,
    meta,
    rowsFound: classified.rowsFound,
    newCount: classified.newRows.length,
    duplicateCount: classified.duplicateRows.length,
    invalidCount: classified.invalidRows.length,
    skippedCount: classified.skippedRows.length,
    sampleNew: classified.newRows.slice(0, 10).map((r) => r.leadFields),
    sampleDuplicates: classified.duplicateRows.slice(0, 5).map((r) => ({
      ...r.leadFields,
      existingLeadCode: r.existingLeadCode,
    })),
    sampleInvalid: classified.invalidRows.slice(0, 5).map((r) => ({
      fields: r.leadFields,
      errors: r.errors,
    })),
  };

  const log = await ConnectorSyncLog.create({
    connector: connector._id,
    connectorType: connector.type,
    connectorName: connector.name,
    triggeredBy: 'user',
    triggeredByUser: user?._id,
    mode: 'preview',
    status: 'completed',
    startedAt,
    completedAt: new Date(),
    durationMs: Date.now() - startedAt.getTime(),
    rowsFound: preview.rowsFound,
    newCount: preview.newCount,
    duplicateCount: preview.duplicateCount,
    invalidCount: preview.invalidCount,
    skippedCount: preview.skippedCount,
    previewPayload: {
      // Store row payloads needed to commit without re-fetch (capped)
      newRows: classified.newRows.slice(0, 5000),
      duplicateRows: classified.duplicateRows.slice(0, 5000),
    },
    previewExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });

  return { previewId: log._id, ...preview };
};

const applyDefaults = (leadFields, connector) => ({
  ...leadFields,
  source: leadFields.source || connector.defaultLeadSource,
  status: connector.defaultLeadStatus || LEAD_STATUSES.NEW,
  priority: connector.defaultPriority || LEAD_PRIORITIES.YELLOW,
  department: connector.department,
  assignedTo: connector.defaultAssignedUser || undefined,
});

const buildLeadWritePayload = (leadFields, connector) => {
  const fields = applyDefaults(leadFields, connector);
  delete fields._rowKey;
  return pickPersistableLeadFields(fields);
};

/**
 * Commit import: insert new leads; optionally update duplicates; full replace for SA.
 * Supports live progress via syncLog.processedCount / totalToProcess.
 */
export const commitConnectorImport = async ({
  connector,
  user,
  previewId,
  mode = 'import',
  triggeredBy = 'user',
  syncLogId = null,
  jobId = null,
}) => {
  const adapter = getAdapter(connector.type);
  const syncMode = connector.syncMode || SYNC_MODES.INSERT_ONLY;
  const startedAt = new Date();

  let syncLog = null;
  if (syncLogId) {
    syncLog = await ConnectorSyncLog.findById(syncLogId);
  }

  if (syncLog) {
    syncLog.status = 'running';
    syncLog.phase = 'fetching';
    syncLog.startedAt = startedAt;
    if (jobId) syncLog.jobId = String(jobId);
    await syncLog.save();
  }

  let classified;
  let previewLog = null;

  if (previewId) {
    previewLog = await ConnectorSyncLog.findById(previewId);
    if (!previewLog || String(previewLog.connector) !== String(connector._id)) {
      throw new Error('Invalid or expired preview');
    }
    classified = {
      rowsFound: previewLog.rowsFound,
      newRows: previewLog.previewPayload?.newRows || [],
      duplicateRows: previewLog.previewPayload?.duplicateRows || [],
      invalidRows: [],
      skippedRows: [],
    };
  } else {
    const { rows } = await adapter.fetchRows(connector);

    if (syncLog) {
      await ConnectorSyncLog.findByIdAndUpdate(syncLog._id, {
        status: 'running',
        phase: 'classifying',
        rowsFound: rows.length,
        processedCount: 0,
        totalToProcess: rows.length,
      });
    }

    let lastClassifyWrite = 0;
    classified = await classifyRows({
      rows,
      connector,
      adapter,
      onProgress: syncLog
        ? async ({ processed, total }) => {
          const now = Date.now();
          if (now - lastClassifyWrite < 500 && processed !== total) return;
          lastClassifyWrite = now;
          await ConnectorSyncLog.findByIdAndUpdate(syncLog._id, {
            phase: 'classifying',
            rowsFound: total,
            processedCount: processed,
            totalToProcess: total,
          });
        }
        : undefined,
    });
  }

  const processUpdates =
    syncMode === SYNC_MODES.INSERT_UPDATE || syncMode === SYNC_MODES.FULL_REPLACE;
  const totalToProcess =
    classified.newRows.length + (processUpdates ? classified.duplicateRows.length : 0);
  const rowsFound =
    classified.rowsFound || classified.newRows.length + classified.duplicateRows.length;

  if (!syncLog) {
    syncLog = await ConnectorSyncLog.create({
      connector: connector._id,
      connectorType: connector.type,
      connectorName: connector.name,
      triggeredBy,
      triggeredByUser: user?._id,
      mode,
      status: 'running',
      phase: 'importing',
      startedAt,
      jobId: jobId ? String(jobId) : undefined,
      rowsFound,
      newCount: classified.newRows.length,
      duplicateCount: classified.duplicateRows.length,
      invalidCount: classified.invalidRows?.length || 0,
      skippedCount: classified.skippedRows?.length || 0,
      processedCount: 0,
      totalToProcess,
    });
  } else {
    await ConnectorSyncLog.findByIdAndUpdate(syncLog._id, {
      status: 'running',
      phase: 'importing',
      rowsFound,
      newCount: classified.newRows.length,
      duplicateCount: classified.duplicateRows.length,
      invalidCount: classified.invalidRows?.length || 0,
      skippedCount: classified.skippedRows?.length || 0,
      processedCount: 0,
      totalToProcess,
      connectorName: connector.name,
      connectorType: connector.type,
    });
  }

  let importedCount = 0;
  let updatedCount = 0;
  let failedCount = 0;
  let processedCount = 0;
  const errors = [];
  let lastProgressWrite = 0;

  const bumpProgress = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressWrite < 300) return;
    lastProgressWrite = now;
    await ConnectorSyncLog.findByIdAndUpdate(syncLog._id, {
      processedCount,
      importedCount,
      updatedCount,
      phase: 'importing',
    });
  };

  try {
    if (syncMode === SYNC_MODES.FULL_REPLACE) {
      await Lead.updateMany(
        {
          isDeleted: false,
          'importMeta.connectorId': String(connector._id),
        },
        { $set: { isDeleted: true } }
      );
    }

    for (const item of classified.newRows) {
      try {
        const persistable = buildLeadWritePayload(item.leadFields, connector);
        const leadId = await generateLeadId(Lead);
        const lead = await Lead.create({
          ...persistable,
          leadId,
          createdBy: user?._id || connector.createdBy,
          duplicateHash: buildDuplicateHash(persistable.phone, persistable.email),
          importMeta: {
            connectorId: String(connector._id),
            connectorType: connector.type,
            connectorName: connector.name,
            externalRef: {
              spreadsheetId: connector.config?.spreadsheetId,
              worksheet: connector.config?.worksheetName,
              sheetTitle: connector.config?.spreadsheetTitle,
              rowKey: item.rowKey,
            },
            importedAt: new Date(),
            importedBy: user?._id,
            lastSyncedAt: new Date(),
            originalRow: item.row,
          },
        });

        await addTimelineEvent({
          leadId: lead._id,
          type: TIMELINE_EVENT_TYPES.IMPORTED_FROM_CONNECTOR,
          title: 'Imported from connector',
          description: `Imported from ${connector.type.replace('_', ' ')}: ${connector.name}`,
          actor: user?._id,
          actorName: user?.name,
          metadata: {
            connectorId: connector._id,
            connectorName: connector.name,
            connectorType: connector.type,
          },
        });

        importedCount += 1;
      } catch (err) {
        failedCount += 1;
        errors.push({ message: err.message, row: item.rowKey });
      }
      processedCount += 1;
      if (processedCount % 3 === 0 || processedCount === totalToProcess) {
        await bumpProgress();
      }
    }

    if (processUpdates) {
      for (const item of classified.duplicateRows) {
        try {
          if (!item.existingLeadId || String(item.existingLeadId) === 'pending') {
            processedCount += 1;
            if (processedCount % 3 === 0 || processedCount === totalToProcess) {
              await bumpProgress();
            }
            continue;
          }
          const persistable = buildLeadWritePayload(item.leadFields, connector);
          delete persistable.status;

          const existing = await Lead.findById(item.existingLeadId).select('customFields leadDate createdAt');
          const $set = {
            name: persistable.name,
            phone: persistable.phone,
            email: persistable.email,
            course: persistable.course,
            'importMeta.lastSyncedAt': new Date(),
            'importMeta.originalRow': item.row,
            lastActivityAt: new Date(),
          };
          if (persistable.customFields?.length) {
            $set.customFields = mergeCustomFields(existing?.customFields || [], persistable.customFields);
          }
          $set.leadDate = resolveLeadDate({
            customFields: $set.customFields || existing?.customFields,
            importMeta: { originalRow: item.row },
            leadDate: persistable.leadDate || existing?.leadDate,
            createdAt: existing?.createdAt,
          }) || existing?.createdAt || new Date();

          const updated = await Lead.findByIdAndUpdate(
            item.existingLeadId,
            { $set },
            { new: true }
          );
          if (updated) {
            await addTimelineEvent({
              leadId: updated._id,
              type: TIMELINE_EVENT_TYPES.UPDATED_BY_SYNC,
              title: 'Updated by sync',
              description: `Updated from ${connector.name}`,
              actor: user?._id,
              actorName: user?.name,
              metadata: { connectorId: connector._id },
            });
            updatedCount += 1;
          }
        } catch (err) {
          failedCount += 1;
          errors.push({ message: err.message, row: item.rowKey });
        }
        processedCount += 1;
        if (processedCount % 3 === 0 || processedCount === totalToProcess) {
          await bumpProgress();
        }
      }
    }

    await bumpProgress(true);

    const completedAt = new Date();
    await ConnectorSyncLog.findByIdAndUpdate(syncLog._id, {
      status: failedCount && !importedCount && !updatedCount ? 'failed' : 'completed',
      phase: 'done',
      completedAt,
      durationMs: completedAt - startedAt,
      processedCount,
      totalToProcess,
      importedCount,
      updatedCount,
      errorSummary: errors.length ? errors[0].message : undefined,
      errors: errors.slice(0, 50),
    });

    const health = connector.health || {};
    await Connector.findByIdAndUpdate(connector._id, {
      lastSyncAt: completedAt,
      lastSuccessAt: completedAt,
      lastErrorAt: failedCount ? completedAt : connector.lastErrorAt,
      lastErrorMessage: errors[0]?.message,
      status: CONNECTOR_STATUSES.ACTIVE,
      health: {
        ...health,
        connectionStatus: CONNECTOR_HEALTH.CONNECTION.CONNECTED,
        apiStatus: CONNECTOR_HEALTH.API.OK,
        permissionStatus: CONNECTOR_HEALTH.PERMISSION.OK,
        totalImported: (health.totalImported || 0) + importedCount,
        totalDuplicates: (health.totalDuplicates || 0) + classified.duplicateRows.length,
        totalFailed: (health.totalFailed || 0) + failedCount,
      },
    });

    if (user) {
      await logActivity({
        user,
        action: ACTIVITY_ACTIONS.CONNECTOR_SYNC,
        entityType: ENTITY_TYPES.CONNECTOR,
        entityId: connector._id,
        metadata: { importedCount, updatedCount, duplicateCount: classified.duplicateRows.length },
      });
    }

    return {
      syncLogId: syncLog._id,
      importedCount,
      updatedCount,
      duplicateCount: classified.duplicateRows.length,
      invalidCount: classified.invalidRows?.length || 0,
      failedCount,
      processedCount,
      totalToProcess,
    };
  } catch (error) {
    logger.error('Connector import failed', { error: error.message, connectorId: connector._id });
    await ConnectorSyncLog.findByIdAndUpdate(syncLog._id, {
      status: 'failed',
      phase: 'done',
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
      processedCount,
      errorSummary: error.message,
    });
    await Connector.findByIdAndUpdate(connector._id, {
      lastSyncAt: new Date(),
      lastErrorAt: new Date(),
      lastErrorMessage: error.message,
      status: CONNECTOR_STATUSES.ERROR,
      'health.apiStatus': CONNECTOR_HEALTH.API.ERROR,
    });
    throw error;
  }
};

export default { previewConnectorImport, commitConnectorImport };
