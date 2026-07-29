import mongoose from 'mongoose';
import { ACTIVITY_ACTIONS, ENTITY_TYPES } from '../constants/index.js';

const activityLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    userName: { type: String, required: true },
    userRole: { type: String, required: true, index: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', index: true },
    action: {
      type: String,
      enum: Object.values(ACTIVITY_ACTIONS),
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: Object.values(ENTITY_TYPES),
      required: true,
      index: true,
    },
    entityId: { type: String, index: true },
    previousValues: mongoose.Schema.Types.Mixed,
    updatedValues: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    deviceInfo: {
      userAgent: String,
      platform: String,
      mobile: String,
    },
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

activityLogSchema.index({ department: 1, createdAt: -1 });
activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
export default ActivityLog;
