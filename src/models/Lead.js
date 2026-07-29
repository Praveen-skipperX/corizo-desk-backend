import mongoose from 'mongoose';
import {
  LEAD_PRIORITIES,
  LEAD_STATUSES,
  LEAD_SOURCES,
  TRANSFER_STATUSES,
} from '../constants/index.js';

const addressSchema = new mongoose.Schema(
  {
    street: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'India' },
  },
  { _id: false }
);

const sourceDetailsSchema = new mongoose.Schema(
  {
    externalId: String,
    url: String,
    campaign: String,
    referrer: String,
    rawPayload: mongoose.Schema.Types.Mixed,
  },
  { _id: false }
);

const importMetaSchema = new mongoose.Schema(
  {
    connectorId: String,
    connectorType: String,
    connectorName: String,
    externalRef: mongoose.Schema.Types.Mixed,
    importedAt: Date,
    importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastSyncedAt: Date,
    originalRow: mongoose.Schema.Types.Mixed,
  },
  { _id: false }
);

const transferRequestSchema = new mongoose.Schema(
  {
    fromDepartment: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    toDepartment: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: String,
    status: {
      type: String,
      enum: Object.values(TRANSFER_STATUSES),
      default: TRANSFER_STATUSES.PENDING,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    reviewNotes: String,
  },
  { timestamps: true }
);

const leadSchema = new mongoose.Schema(
  {
    leadId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, index: true },
    phone: { type: String, required: true, trim: true, index: true },
    address: addressSchema,
    course: { type: String, trim: true, index: true },
    source: {
      type: String,
      enum: Object.values(LEAD_SOURCES),
      default: LEAD_SOURCES.MANUAL,
      index: true,
    },
    sourceDetails: sourceDetailsSchema,
    importMeta: importMetaSchema,
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: Object.values(LEAD_PRIORITIES),
      default: LEAD_PRIORITIES.YELLOW,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(LEAD_STATUSES),
      default: LEAD_STATUSES.NEW,
      index: true,
    },
    nextFollowUpDate: { type: Date, index: true },
    /** Sheet / enquiry date shown in the Leads "Date" column (denormalized for filtering). */
    leadDate: { type: Date, index: true },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    duplicateHash: { type: String, index: true },
    isDeleted: { type: Boolean, default: false },
    /**
     * Dynamic fields from sheet mapping (confirmed custom columns).
     * Not free-form schema — only keys confirmed in connector fieldMapping.
     */
    customFields: {
      type: [
        {
          key: { type: String, required: true, trim: true },
          label: { type: String, required: true, trim: true },
          value: { type: String, default: '', trim: true },
        },
      ],
      default: [],
    },
    transferRequest: transferRequestSchema,
    dealClosure: {
      amount: Number,
      closureDate: Date,
      closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      notes: String,
    },
  },
  { timestamps: true }
);

leadSchema.index({ department: 1, status: 1 });
leadSchema.index({ department: 1, assignedTo: 1 });
leadSchema.index({ department: 1, priority: 1, nextFollowUpDate: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ name: 'text', email: 'text', phone: 'text' });

const Lead = mongoose.model('Lead', leadSchema);
export default Lead;
