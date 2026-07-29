import mongoose from 'mongoose';
import { NOTIFICATION_TYPES } from '../constants/index.js';

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPES),
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    data: mongoose.Schema.Types.Mixed,
    isRead: { type: Boolean, default: false, index: true },
    emailSent: { type: Boolean, default: false },
    emailSentAt: Date,
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
export default Notification;
