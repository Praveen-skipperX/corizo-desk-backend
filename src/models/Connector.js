import mongoose from 'mongoose';
import {
  CONNECTOR_TYPES,
  CONNECTOR_STATUSES,
  DUPLICATE_RULES,
  SYNC_MODES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_PRIORITIES,
  CONNECTOR_HEALTH,
} from '../constants/index.js';

const fieldMappingSchema = new mongoose.Schema(
  {
    sourceColumn: { type: String, required: true, trim: true },
    /** System lead field key, or "__custom__" for dynamic sheet columns */
    targetField: { type: String, required: true, trim: true },
    required: { type: Boolean, default: false },
    /** Only for targetField === "__custom__" */
    customKey: { type: String, trim: true },
    customLabel: { type: String, trim: true },
  },
  { _id: false }
);

const duplicateRuleSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(DUPLICATE_RULES),
      default: DUPLICATE_RULES.PHONE_EMAIL,
    },
    customField: String,
  },
  { _id: false }
);

const healthSchema = new mongoose.Schema(
  {
    connectionStatus: {
      type: String,
      enum: Object.values(CONNECTOR_HEALTH.CONNECTION),
      default: CONNECTOR_HEALTH.CONNECTION.UNKNOWN,
    },
    apiStatus: {
      type: String,
      enum: Object.values(CONNECTOR_HEALTH.API),
      default: CONNECTOR_HEALTH.API.UNKNOWN,
    },
    permissionStatus: {
      type: String,
      enum: Object.values(CONNECTOR_HEALTH.PERMISSION),
      default: CONNECTOR_HEALTH.PERMISSION.UNKNOWN,
    },
    totalImported: { type: Number, default: 0 },
    totalDuplicates: { type: Number, default: 0 },
    totalFailed: { type: Number, default: 0 },
  },
  { _id: false }
);

const connectorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    type: {
      type: String,
      enum: Object.values(CONNECTOR_TYPES),
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(CONNECTOR_STATUSES),
      default: CONNECTOR_STATUSES.ACTIVE,
      index: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
      index: true,
    },
    defaultLeadSource: {
      type: String,
      enum: Object.values(LEAD_SOURCES),
      default: LEAD_SOURCES.WEBSITE,
    },
    defaultAssignedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    defaultLeadStatus: {
      type: String,
      enum: Object.values(LEAD_STATUSES),
      default: LEAD_STATUSES.NEW,
    },
    defaultPriority: {
      type: String,
      enum: Object.values(LEAD_PRIORITIES),
      default: LEAD_PRIORITIES.YELLOW,
    },
    autoSyncEnabled: { type: Boolean, default: false },
    syncIntervalMinutes: { type: Number, default: 60, min: 5 },
    syncMode: {
      type: String,
      enum: Object.values(SYNC_MODES),
      default: SYNC_MODES.INSERT_ONLY,
    },
    duplicateRule: {
      type: duplicateRuleSchema,
      default: () => ({ type: DUPLICATE_RULES.PHONE_EMAIL }),
    },
    fieldMapping: { type: [fieldMappingSchema], default: [] },
    uniqueKeyColumn: { type: String, trim: true },
    headerRow: { type: Number, default: 1, min: 1 },
    mappingTemplate: { type: mongoose.Schema.Types.ObjectId, ref: 'MappingTemplate' },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    health: { type: healthSchema, default: () => ({}) },
    lastSyncAt: Date,
    lastSuccessAt: Date,
    lastErrorAt: Date,
    lastErrorMessage: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

connectorSchema.index({ type: 1, status: 1, isDeleted: 1 });
connectorSchema.index({ department: 1, type: 1 });

const Connector = mongoose.model('Connector', connectorSchema);
export default Connector;
