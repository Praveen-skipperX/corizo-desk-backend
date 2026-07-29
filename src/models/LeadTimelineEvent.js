import mongoose from 'mongoose';
import { TIMELINE_EVENT_TYPES } from '../constants/index.js';

const leadTimelineEventSchema = new mongoose.Schema(
  {
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(TIMELINE_EVENT_TYPES),
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    description: String,
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: String,
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

leadTimelineEventSchema.index({ lead: 1, createdAt: -1 });

const LeadTimelineEvent = mongoose.model('LeadTimelineEvent', leadTimelineEventSchema);
export default LeadTimelineEvent;
