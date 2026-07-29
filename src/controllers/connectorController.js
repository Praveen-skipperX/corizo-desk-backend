import config from '../config/index.js';
import { AppError, asyncHandler, successResponse, paginatedResponse } from '../utils/apiResponse.js';
import { buildPagination, parseSort, resolveDepartmentId } from '../utils/helpers.js';
import {
  Connector,
  ConnectorSyncLog,
  MappingTemplate,
  Department,
} from '../models/index.js';
import {
  ROLES,
  CONNECTOR_TYPES,
  CONNECTOR_STATUSES,
  SYNC_MODES,
  DUPLICATE_RULES,
  ACTIVITY_ACTIONS,
  ENTITY_TYPES,
} from '../constants/index.js';
import { getAdapter, listConnectorTypes, isConnectorImplemented } from '../connectors/index.js';
import { parseSpreadsheetId } from '../connectors/googleSheets/GoogleSheetsAdapter.js';
import { previewConnectorImport, commitConnectorImport } from '../services/leadImportService.js';
import { addConnectorSyncJob } from '../queues/index.js';
import { shouldRunJobsInline, deferWork } from '../utils/runtime.js';
import { logActivity } from '../services/auditService.js';
import logger from '../utils/logger.js';
import {
  sanitizeCustomFieldKey,
  sanitizeCustomFieldLabel,
  CUSTOM_FIELD_LIMITS,
  SYSTEM_LEAD_FIELD_KEYS,
} from '../utils/customFields.js';

const CUSTOM_TARGET = '__custom__';

const SYSTEM_MAP_TARGETS = new Set(['name', 'phone', 'email', 'course', 'source', 'priority', 'status']);

/** Normalize and cap field mappings; only confirmed custom columns are kept. */
const sanitizeFieldMapping = (mapping = []) => {
  const out = [];
  let customCount = 0;
  const usedCustomKeys = new Set();

  for (const raw of mapping) {
    if (!raw?.sourceColumn || !raw?.targetField) continue;
    const sourceColumn = String(raw.sourceColumn).trim().slice(0, 200);
    if (!sourceColumn) continue;

    if (raw.targetField === CUSTOM_TARGET || raw.targetField === 'custom') {
      if (customCount >= CUSTOM_FIELD_LIMITS.maxFields) continue;
      const customKey = sanitizeCustomFieldKey(raw.customKey || raw.customLabel || sourceColumn);
      if (!customKey || usedCustomKeys.has(customKey)) continue;
      if (SYSTEM_LEAD_FIELD_KEYS.has(customKey) && !customKey.startsWith('x_')) continue;
      usedCustomKeys.add(customKey);
      customCount += 1;
      out.push({
        sourceColumn,
        targetField: CUSTOM_TARGET,
        required: false,
        customKey,
        customLabel: sanitizeCustomFieldLabel(raw.customLabel || sourceColumn, sourceColumn),
      });
      continue;
    }

    if (!SYSTEM_MAP_TARGETS.has(raw.targetField)) continue;
    out.push({
      sourceColumn,
      targetField: raw.targetField,
      required: Boolean(raw.required) || ['name', 'phone'].includes(raw.targetField),
    });
  }

  return out;
};

const populateConnector = (q) =>
  q
    .populate('department', 'name code')
    .populate('defaultAssignedUser', 'name email')
    .populate('createdBy', 'name email')
    .populate('mappingTemplate', 'name');


const assertConnectorAccess = (user, connector) => {
  if (!connector || connector.isDeleted) {
    throw new AppError('Connector not found', 404);
  }
  if (user.role === ROLES.SUPER_ADMIN) return;
  if (user.role === ROLES.ADMIN) {
    const dept = user.department?._id?.toString() || user.department?.toString();
    if (dept !== connector.department?.toString() && dept !== connector.department?._id?.toString()) {
      throw new AppError('Access denied', 403, 'FORBIDDEN');
    }
    return;
  }
  throw new AppError('Access denied', 403, 'FORBIDDEN');
};

const buildConnectorScope = (user) => {
  if (user.role === ROLES.SUPER_ADMIN) return { isDeleted: false };
  if (user.role === ROLES.ADMIN) {
    return { isDeleted: false, department: user.department?._id || user.department };
  }
  return { isDeleted: false, _id: null };
};

export const listConnectorTypesHandler = asyncHandler(async (_req, res) => {
  successResponse(res, listConnectorTypes());
});

/** Safe Google Sheets setup info for admins (never exposes private key). */
export const getGoogleSheetsSetup = asyncHandler(async (_req, res) => {
  const email = (config.google?.clientEmail || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  successResponse(res, {
    serviceAccountEmail: email || null,
    configured: Boolean(email),
    shareAccess: 'Viewer',
    shareAccessForFullReplace: 'Editor',
  });
});

export const listConnectors = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, type = CONNECTOR_TYPES.GOOGLE_SHEETS, status, search } = req.query;
  const filter = { ...buildConnectorScope(req.user) };
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (search) filter.name = { $regex: search, $options: 'i' };

  const skip = (Number(page) - 1) * Number(limit);
  const [rows, total] = await Promise.all([
    populateConnector(Connector.find(filter).sort(parseSort(req.query.sortBy, req.query.sortOrder)))
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    Connector.countDocuments(filter),
  ]);

  paginatedResponse(res, rows, buildPagination(page, limit, total));
});

export const getConnector = asyncHandler(async (req, res) => {
  const connector = await populateConnector(Connector.findById(req.params.id));
  assertConnectorAccess(req.user, connector);
  successResponse(res, connector);
});

export const createConnector = asyncHandler(async (req, res) => {
  const data = req.body;
  const type = data.type || CONNECTOR_TYPES.GOOGLE_SHEETS;

  if (!isConnectorImplemented(type)) {
    throw new AppError(`Connector type "${type}" is not available yet`, 400);
  }

  if (data.syncMode === SYNC_MODES.FULL_REPLACE) {
    const canFullReplace = req.permissionKeys?.has('google_sheets.full_replace')
      || req.user.role === ROLES.SUPER_ADMIN;
    if (!canFullReplace) {
      throw new AppError('Full Replace sync mode requires google_sheets.full_replace permission', 403, 'FORBIDDEN');
    }
  }

  const adapter = getAdapter(type);
  let config = data.config || {};

  if (type === CONNECTOR_TYPES.GOOGLE_SHEETS) {
    const spreadsheetId = parseSpreadsheetId(data.spreadsheetUrl || config.spreadsheetId);
    if (!spreadsheetId) throw new AppError('Valid Spreadsheet URL or ID is required', 400);
    config = await adapter.validateConfig({
      ...config,
      spreadsheetUrl: data.spreadsheetUrl || config.spreadsheetUrl,
      spreadsheetId,
      worksheetName: data.worksheetName || config.worksheetName,
    });
  }

  let departmentId =
    req.user.role === ROLES.ADMIN
      ? req.user.department?._id || req.user.department
      : data.department;

  departmentId = await resolveDepartmentId(Department, departmentId);
  if (!departmentId) throw new AppError('No active department available. Create one or contact support.', 400);

  let fieldMapping = sanitizeFieldMapping(data.fieldMapping || []);
  if (data.mappingTemplateId) {
    const template = await MappingTemplate.findOne({
      _id: data.mappingTemplateId,
      isDeleted: false,
    });
    if (template) {
      fieldMapping = sanitizeFieldMapping(template.fieldMapping);
      data.uniqueKeyColumn = data.uniqueKeyColumn || template.uniqueKeyColumn;
      data.headerRow = data.headerRow || template.headerRow;
    }
  }

  const connector = await Connector.create({
    name: data.name,
    type,
    department: departmentId,
    defaultLeadSource: data.defaultLeadSource,
    defaultAssignedUser: data.defaultAssignedUser || undefined,
    defaultLeadStatus: data.defaultLeadStatus,
    defaultPriority: data.defaultPriority,
    autoSyncEnabled: Boolean(data.autoSyncEnabled),
    syncIntervalMinutes: data.syncIntervalMinutes || 60,
    syncMode: data.syncMode || SYNC_MODES.INSERT_ONLY,
    duplicateRule: data.duplicateRule || { type: DUPLICATE_RULES.PHONE_EMAIL },
    fieldMapping,
    uniqueKeyColumn: data.uniqueKeyColumn,
    headerRow: data.headerRow || 1,
    mappingTemplate: data.mappingTemplateId || undefined,
    config,
    createdBy: req.user._id,
  });

  // Test connection and update health
  try {
    const health = await adapter.testConnection(connector);
    connector.health = {
      ...connector.health?.toObject?.() || connector.health || {},
      connectionStatus: health.connectionStatus,
      apiStatus: health.apiStatus,
      permissionStatus: health.permissionStatus,
    };
    if (health.spreadsheetTitle) {
      connector.config = { ...connector.config, spreadsheetTitle: health.spreadsheetTitle };
    }
    await connector.save();
  } catch {
    /* health remains unknown */
  }

  if (data.saveAsTemplate && data.templateName) {
    await MappingTemplate.create({
      name: data.templateName,
      connectorType: type,
      fieldMapping,
      uniqueKeyColumn: data.uniqueKeyColumn,
      headerRow: data.headerRow || 1,
      department: departmentId,
      createdBy: req.user._id,
    });
  }

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.CREATE,
    entityType: ENTITY_TYPES.CONNECTOR,
    entityId: connector._id,
    metadata: { name: connector.name, type },
  });

  const populated = await populateConnector(Connector.findById(connector._id));
  successResponse(res, populated, 'Connector created', 201);
});

export const updateConnector = asyncHandler(async (req, res) => {
  const connector = await Connector.findById(req.params.id);
  assertConnectorAccess(req.user, connector);

  const data = req.body;
  if (data.syncMode === SYNC_MODES.FULL_REPLACE) {
    const canFullReplace = req.permissionKeys?.has('google_sheets.full_replace')
      || req.user.role === ROLES.SUPER_ADMIN;
    if (!canFullReplace) {
      throw new AppError('Full Replace sync mode requires google_sheets.full_replace permission', 403, 'FORBIDDEN');
    }
  }

  const fields = [
    'name',
    'defaultLeadSource',
    'defaultAssignedUser',
    'defaultLeadStatus',
    'defaultPriority',
    'autoSyncEnabled',
    'syncIntervalMinutes',
    'syncMode',
    'duplicateRule',
    'uniqueKeyColumn',
    'headerRow',
  ];
  fields.forEach((f) => {
    if (data[f] !== undefined) connector[f] = data[f];
  });
  if (data.fieldMapping !== undefined) {
    connector.fieldMapping = sanitizeFieldMapping(data.fieldMapping);
  }

  if (req.user.role === ROLES.SUPER_ADMIN && data.department) {
    connector.department = data.department;
  }

  if (data.spreadsheetUrl || data.worksheetName || data.config) {
    const adapter = getAdapter(connector.type);
    connector.config = await adapter.validateConfig({
      ...connector.config,
      ...data.config,
      spreadsheetUrl: data.spreadsheetUrl || connector.config.spreadsheetUrl,
      worksheetName: data.worksheetName || connector.config.worksheetName,
    });
  }

  await connector.save();
  const populated = await populateConnector(Connector.findById(connector._id));
  successResponse(res, populated, 'Connector updated');
});

export const disableConnector = asyncHandler(async (req, res) => {
  const connector = await Connector.findById(req.params.id);
  assertConnectorAccess(req.user, connector);
  connector.status = CONNECTOR_STATUSES.DISABLED;
  connector.autoSyncEnabled = false;
  await connector.save();
  successResponse(res, connector, 'Connector disabled');
});

export const enableConnector = asyncHandler(async (req, res) => {
  const connector = await Connector.findById(req.params.id);
  assertConnectorAccess(req.user, connector);
  connector.status = CONNECTOR_STATUSES.ACTIVE;
  await connector.save();
  successResponse(res, connector, 'Connector enabled');
});

export const deleteConnector = asyncHandler(async (req, res) => {
  const connector = await Connector.findById(req.params.id);
  assertConnectorAccess(req.user, connector);
  connector.isDeleted = true;
  connector.status = CONNECTOR_STATUSES.DISABLED;
  connector.autoSyncEnabled = false;
  await connector.save();
  successResponse(res, null, 'Connector deleted');
});

export const getConnectorHealth = asyncHandler(async (req, res) => {
  const connector = await Connector.findById(req.params.id);
  assertConnectorAccess(req.user, connector);

  const adapter = getAdapter(connector.type);
  const live = await adapter.testConnection(connector);

  connector.health = {
    ...connector.health?.toObject?.() || {},
    connectionStatus: live.connectionStatus,
    apiStatus: live.apiStatus,
    permissionStatus: live.permissionStatus,
  };
  await connector.save();

  successResponse(res, {
    ...connector.health.toObject?.() || connector.health,
    lastSyncAt: connector.lastSyncAt,
    lastSuccessAt: connector.lastSuccessAt,
    lastErrorAt: connector.lastErrorAt,
    lastErrorMessage: connector.lastErrorMessage,
    status: connector.status,
    message: live.message,
  });
});

export const fetchConnectorHeaders = asyncHandler(async (req, res) => {
  const { spreadsheetUrl, worksheetName, headerRow = 1, connectorId } = req.body;

  let connector;
  if (connectorId) {
    connector = await Connector.findById(connectorId);
    assertConnectorAccess(req.user, connector);
  } else {
    const spreadsheetId = parseSpreadsheetId(spreadsheetUrl);
    if (!spreadsheetId || !worksheetName) {
      throw new AppError('spreadsheetUrl and worksheetName are required', 400);
    }
    connector = {
      type: CONNECTOR_TYPES.GOOGLE_SHEETS,
      headerRow: Number(headerRow) || 1,
      config: { spreadsheetId, worksheetName },
      fieldMapping: [],
    };
  }

  const adapter = getAdapter(connector.type || CONNECTOR_TYPES.GOOGLE_SHEETS);
  const headers = await adapter.fetchHeaders(connector);
  successResponse(res, { headers });
});

export const previewSync = asyncHandler(async (req, res) => {
  const connector = await Connector.findById(req.params.id);
  assertConnectorAccess(req.user, connector);
  const result = await previewConnectorImport({ connector, user: req.user });
  successResponse(res, result);
});

export const confirmImport = asyncHandler(async (req, res) => {
  const connector = await Connector.findById(req.params.id);
  assertConnectorAccess(req.user, connector);

  if (connector.syncMode === SYNC_MODES.FULL_REPLACE) {
    const canFullReplace = req.permissionKeys?.has('google_sheets.full_replace')
      || req.user.role === ROLES.SUPER_ADMIN;
    if (!canFullReplace) {
      throw new AppError('Full Replace requires google_sheets.full_replace permission', 403, 'FORBIDDEN');
    }
  }

  const result = await commitConnectorImport({
    connector,
    user: req.user,
    previewId: req.body.previewId,
    mode: 'import',
  });
  successResponse(res, result, 'Import completed');
});

const createPendingSyncLog = async ({ connector, user, triggeredBy = 'user' }) =>
  ConnectorSyncLog.create({
    connector: connector._id,
    connectorType: connector.type || CONNECTOR_TYPES.GOOGLE_SHEETS,
    connectorName: connector.name,
    triggeredBy,
    triggeredByUser: user?._id,
    mode: 'sync',
    status: 'pending',
    phase: 'queued',
    processedCount: 0,
    totalToProcess: 0,
  });

const markSyncFailed = async (syncLogId, message) => {
  if (!syncLogId) return;
  try {
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

const runInlineConnectorSync = async ({ connector, user, triggeredBy, syncLogId, jobId }) => {
  try {
    await commitConnectorImport({
      connector,
      user,
      mode: 'sync',
      triggeredBy,
      syncLogId,
      jobId,
    });
  } catch (err) {
    await markSyncFailed(syncLogId, err.message || 'Sync failed');
    logger.error(`Inline connector sync failed (${syncLogId}):`, err.message || err);
  }
};

export const syncConnector = asyncHandler(async (req, res) => {
  const connector = await Connector.findById(req.params.id);
  assertConnectorAccess(req.user, connector);

  if (connector.status === CONNECTOR_STATUSES.DISABLED) {
    throw new AppError('Connector is disabled', 400);
  }

  if (connector.syncMode === SYNC_MODES.FULL_REPLACE) {
    const canFullReplace = req.permissionKeys?.has('google_sheets.full_replace')
      || req.user.role === ROLES.SUPER_ADMIN;
    if (!canFullReplace) {
      throw new AppError('Full Replace requires google_sheets.full_replace permission', 403, 'FORBIDDEN');
    }
  }

  const syncLog = await createPendingSyncLog({ connector, user: req.user, triggeredBy: 'user' });

  // Vercel / no workers: run import inline (waitUntil when available) so sync actually runs
  // and SyncProgressDock can poll ConnectorSyncLog progress.
  if (shouldRunJobsInline()) {
    const jobId = `inline-${syncLog._id}`;
    syncLog.jobId = jobId;
    await syncLog.save();

    await deferWork(() =>
      runInlineConnectorSync({
        connector,
        user: req.user,
        triggeredBy: 'user',
        syncLogId: syncLog._id.toString(),
        jobId,
      })
    );

    return successResponse(
      res,
      {
        syncLogId: syncLog._id,
        jobId,
        connectorId: connector._id,
        connectorName: connector.name,
        status: 'pending',
        inline: true,
      },
      'Sync started. Progress updates live in the bottom-right panel.'
    );
  }

  const job = await addConnectorSyncJob({
    connectorId: connector._id.toString(),
    userId: req.user._id.toString(),
    triggeredBy: 'user',
    syncLogId: syncLog._id.toString(),
  });

  syncLog.jobId = String(job.id);
  await syncLog.save();

  successResponse(
    res,
    {
      syncLogId: syncLog._id,
      jobId: job.id,
      connectorId: connector._id,
      connectorName: connector.name,
      status: 'pending',
    },
    'Sync started in the background. You can continue working while it runs.'
  );
});

export const syncAllConnectors = asyncHandler(async (req, res) => {
  const filter = {
    ...buildConnectorScope(req.user),
    status: CONNECTOR_STATUSES.ACTIVE,
    type: req.query.type || CONNECTOR_TYPES.GOOGLE_SHEETS,
  };
  const connectors = await Connector.find(filter);
  const jobs = [];

  if (shouldRunJobsInline()) {
    const workItems = [];
    for (const c of connectors) {
      const syncLog = await createPendingSyncLog({ connector: c, user: req.user, triggeredBy: 'user' });
      const jobId = `inline-${syncLog._id}`;
      syncLog.jobId = jobId;
      await syncLog.save();
      jobs.push({
        connectorId: c._id,
        name: c.name,
        jobId,
        syncLogId: syncLog._id,
      });
      workItems.push({
        connector: c,
        syncLogId: syncLog._id.toString(),
        jobId,
      });
    }

    if (workItems.length) {
      await deferWork(async () => {
        // Sequential to avoid exhausting Sheets API / Mongo on serverless
        for (const item of workItems) {
          await runInlineConnectorSync({
            connector: item.connector,
            user: req.user,
            triggeredBy: 'user',
            syncLogId: item.syncLogId,
            jobId: item.jobId,
          });
        }
      });
    }

    return successResponse(
      res,
      { queued: jobs.length, jobs, inline: true },
      jobs.length
        ? 'Sync started. Progress updates live in the bottom-right panel.'
        : 'No active sheets to sync'
    );
  }

  for (const c of connectors) {
    const syncLog = await createPendingSyncLog({ connector: c, user: req.user, triggeredBy: 'user' });
    const job = await addConnectorSyncJob({
      connectorId: c._id.toString(),
      userId: req.user._id.toString(),
      triggeredBy: 'user',
      syncLogId: syncLog._id.toString(),
    });
    syncLog.jobId = String(job.id);
    await syncLog.save();
    jobs.push({
      connectorId: c._id,
      name: c.name,
      jobId: job.id,
      syncLogId: syncLog._id,
    });
  }
  successResponse(
    res,
    { queued: jobs.length, jobs },
    jobs.length
      ? 'Sync started in the background. You can continue working while it runs.'
      : 'No active sheets to sync'
  );
});

export const getSyncProgress = asyncHandler(async (req, res) => {
  // Include soft-deleted connectors so in-flight / recent jobs still appear
  const scope = buildConnectorScope(req.user);
  const connectorFilter = { ...scope };
  delete connectorFilter.isDeleted;
  const accessibleIds = await Connector.find(connectorFilter).select('_id');
  const ids = accessibleIds.map((c) => c._id);

  // Checkpoint: fail abandoned jobs so the live dock doesn't keep ghosts.
  // Pending/queued never leave "waiting for worker" on Vercel without workers —
  // fail those quickly (2 min). Running jobs get a longer stall window.
  const queuedStaleBefore = new Date(Date.now() - 2 * 60 * 1000);
  const runningStaleBefore = new Date(Date.now() - 20 * 60 * 1000);
  const maxAgeBefore = new Date(Date.now() - 60 * 60 * 1000);

  await ConnectorSyncLog.updateMany(
    {
      connector: { $in: ids },
      mode: { $ne: 'preview' },
      status: 'pending',
      createdAt: { $lt: queuedStaleBefore },
    },
    {
      $set: {
        status: 'failed',
        phase: 'done',
        completedAt: new Date(),
        errorSummary: 'Sync never started (queue abandoned). Please try again.',
      },
    }
  );

  await ConnectorSyncLog.updateMany(
    {
      connector: { $in: ids },
      mode: { $ne: 'preview' },
      status: 'running',
      $or: [
        { updatedAt: { $lt: runningStaleBefore } },
        { createdAt: { $lt: maxAgeBefore } },
      ],
    },
    {
      $set: {
        status: 'failed',
        phase: 'done',
        completedAt: new Date(),
        errorSummary: 'Sync timed out or stalled. Please try again.',
      },
    }
  );

  const active = await ConnectorSyncLog.find({
    connector: { $in: ids },
    mode: { $ne: 'preview' },
    status: { $in: ['pending', 'running'] },
  })
    .populate('connector', 'name type')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  // Recently finished (for completion toast) — last 5 minutes
  const since = new Date(Date.now() - 5 * 60 * 1000);
  const recent = await ConnectorSyncLog.find({
    connector: { $in: ids },
    mode: { $ne: 'preview' },
    status: { $in: ['completed', 'failed', 'cancelled'] },
    completedAt: { $gte: since },
  })
    .populate('connector', 'name type')
    .sort({ completedAt: -1 })
    .limit(10)
    .lean();

  const mapLog = (log) => ({
    syncLogId: log._id,
    connectorId: log.connector?._id || log.connector,
    connectorName: log.connectorName || log.connector?.name || 'Sheet',
    status: log.status,
    phase: log.phase || (log.status === 'pending' ? 'queued' : 'importing'),
    processedCount: log.processedCount || 0,
    totalToProcess: log.totalToProcess || 0,
    rowsFound: log.rowsFound || 0,
    importedCount: log.importedCount || 0,
    updatedCount: log.updatedCount || 0,
    errorSummary: log.errorSummary,
    startedAt: log.startedAt || log.createdAt,
    completedAt: log.completedAt,
    updatedAt: log.updatedAt,
    jobId: log.jobId,
  });

  successResponse(res, {
    active: active.map(mapLog),
    recent: recent.map(mapLog),
  });
});

export const listSyncLogs = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, connectorId, status } = req.query;

  // Include soft-deleted connectors so history remains after a sheet is removed
  const scope = buildConnectorScope(req.user);
  const connectorFilter = { ...scope };
  delete connectorFilter.isDeleted;
  if (req.query.type) connectorFilter.type = req.query.type;

  const accessibleIds = await Connector.find(connectorFilter).select('_id');
  const ids = accessibleIds.map((c) => c._id);

  // Same abandoned-job cleanup as live progress (so Sync History doesn't stay Pending)
  const queuedStaleBefore = new Date(Date.now() - 2 * 60 * 1000);
  await ConnectorSyncLog.updateMany(
    {
      connector: { $in: ids },
      mode: { $ne: 'preview' },
      status: 'pending',
      createdAt: { $lt: queuedStaleBefore },
    },
    {
      $set: {
        status: 'failed',
        phase: 'done',
        completedAt: new Date(),
        errorSummary: 'Sync never started (queue abandoned). Please try again.',
      },
    }
  );

  const filter = {
    mode: { $ne: 'preview' },
    ...(ids.length ? { connector: { $in: ids } } : { connector: { $in: [] } }),
  };
  if (connectorId) filter.connector = connectorId;
  if (status) filter.status = status;
  if (req.query.type) filter.connectorType = req.query.type;

  const skip = (Number(page) - 1) * Number(limit);
  const [rows, total] = await Promise.all([
    ConnectorSyncLog.find(filter)
      .populate('connector', 'name type isDeleted status')
      .populate('triggeredByUser', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    ConnectorSyncLog.countDocuments(filter),
  ]);

  const enriched = rows.map((row) => ({
    ...row,
    connectorName: row.connectorName || row.connector?.name || 'Deleted sheet',
    sheetDeleted: Boolean(row.connector?.isDeleted),
  }));

  paginatedResponse(res, enriched, buildPagination(page, limit, total));
});

export const getConnectorDashboard = asyncHandler(async (req, res) => {
  const scope = buildConnectorScope(req.user);
  const type = req.query.type || CONNECTOR_TYPES.GOOGLE_SHEETS;
  const filter = { ...scope, type };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const connectors = await Connector.find(filter).select('_id name lastSyncAt status health autoSyncEnabled');
  const ids = connectors.map((c) => c._id);

  const [importedToday, failedSyncs, pendingJobs, lastSyncLog] = await Promise.all([
    ConnectorSyncLog.aggregate([
      {
        $match: {
          connector: { $in: ids },
          status: 'completed',
          completedAt: { $gte: startOfDay },
          mode: { $ne: 'preview' },
        },
      },
      { $group: { _id: null, total: { $sum: '$importedCount' } } },
    ]),
    ConnectorSyncLog.countDocuments({
      connector: { $in: ids },
      status: 'failed',
      createdAt: { $gte: startOfDay },
    }),
    ConnectorSyncLog.countDocuments({
      connector: { $in: ids },
      status: { $in: ['pending', 'running'] },
    }),
    ConnectorSyncLog.findOne({
      connector: { $in: ids },
      mode: { $ne: 'preview' },
    })
      .sort({ createdAt: -1 })
      .populate('connector', 'name')
      .lean(),
  ]);

  successResponse(res, {
    connectedSheets: connectors.length,
    activeSheets: connectors.filter((c) => c.status === CONNECTOR_STATUSES.ACTIVE).length,
    lastSync: lastSyncLog,
    importedToday: importedToday[0]?.total || 0,
    failedSyncs,
    pendingSyncJobs: pendingJobs,
    sheets: connectors,
  });
});

/* ---- Mapping templates ---- */

export const listMappingTemplates = asyncHandler(async (req, res) => {
  const filter = {
    isDeleted: false,
    connectorType: req.query.type || CONNECTOR_TYPES.GOOGLE_SHEETS,
  };
  if (req.user.role === ROLES.ADMIN) {
    filter.$or = [
      { department: req.user.department?._id || req.user.department },
      { department: null },
    ];
  }
  const templates = await MappingTemplate.find(filter).sort({ name: 1 }).lean();
  successResponse(res, templates);
});

export const createMappingTemplate = asyncHandler(async (req, res) => {
  const template = await MappingTemplate.create({
    name: req.body.name,
    connectorType: req.body.connectorType || CONNECTOR_TYPES.GOOGLE_SHEETS,
    fieldMapping: req.body.fieldMapping || [],
    uniqueKeyColumn: req.body.uniqueKeyColumn,
    headerRow: req.body.headerRow || 1,
    department:
      req.user.role === ROLES.ADMIN
        ? req.user.department._id || req.user.department
        : req.body.department,
    createdBy: req.user._id,
  });
  successResponse(res, template, 'Template saved', 201);
});

export const deleteMappingTemplate = asyncHandler(async (req, res) => {
  const template = await MappingTemplate.findById(req.params.id);
  if (!template || template.isDeleted) throw new AppError('Template not found', 404);
  template.isDeleted = true;
  await template.save();
  successResponse(res, null, 'Template deleted');
});
