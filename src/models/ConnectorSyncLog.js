import mongoose from 'mongoose';
import { CONNECTOR_TYPES } from '../constants/index.js';

const syncErrorSchema = new mongoose.Schema(
  {
    row: Number,
    field: String,
    message: String,
    value: String,
  },
  { _id: false }
);

const connectorSyncLogSchema = new mongoose.Schema(
  {
    connector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Connector',
      required: true,
      index: true,
    },
    connectorType: {
      type: String,
      enum: Object.values(CONNECTOR_TYPES),
      required: true,
      index: true,
    },
    connectorName: String,
    triggeredBy: {
      type: String,
      enum: ['user', 'schedule', 'system'],
      default: 'user',
    },
    triggeredByUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    mode: {
      type: String,
      enum: ['preview', 'import', 'sync'],
      default: 'sync',
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    startedAt: Date,
    completedAt: Date,
    durationMs: Number,
    rowsFound: { type: Number, default: 0 },
    /** Rows processed so far (imports + updates) for live progress UI */
    processedCount: { type: Number, default: 0 },
    /** Total rows expected to process (new + updates) */
    totalToProcess: { type: Number, default: 0 },
    newCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },
    invalidCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    importedCount: { type: Number, default: 0 },
    updatedCount: { type: Number, default: 0 },
    phase: {
      type: String,
      enum: ['queued', 'fetching', 'classifying', 'importing', 'finalizing', 'done'],
      default: 'queued',
    },
    errorSummary: String,
    errors: { type: [syncErrorSchema], default: [] },
    previewPayload: mongoose.Schema.Types.Mixed,
    previewExpiresAt: Date,
    jobId: String,
  },
  { timestamps: true }
);

connectorSyncLogSchema.index({ connector: 1, createdAt: -1 });
connectorSyncLogSchema.index({ status: 1, createdAt: -1 });

const ConnectorSyncLog = mongoose.model('ConnectorSyncLog', connectorSyncLogSchema);
export default ConnectorSyncLog;
