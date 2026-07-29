import mongoose from 'mongoose';
import { FOLLOW_UP_STATUSES } from '../constants/index.js';

const followUpSchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    scheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    scheduledDate: { type: Date, required: true, index: true },
    notes: String,
    status: {
      type: String,
      enum: Object.values(FOLLOW_UP_STATUSES),
      default: FOLLOW_UP_STATUSES.SCHEDULED,
      index: true,
    },
    completedAt: Date,
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    completionNotes: String,
    /** Discussion captured when the scheduled time was reached. */
    discussionNotes: String,
    discussedAt: Date,
    discussedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reminderSent: { type: Boolean, default: false },
    overdueNotified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

followUpSchema.index({ department: 1, scheduledDate: 1, status: 1 });
followUpSchema.index({ assignedTo: 1, scheduledDate: 1, status: 1 });

const FollowUp = mongoose.model('FollowUp', followUpSchema);
export default FollowUp;
