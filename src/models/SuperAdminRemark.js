import mongoose from 'mongoose';

const editHistorySchema = new mongoose.Schema(
  {
    content: String,
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    editedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const superAdminRemarkSchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    content: { type: String, required: true, trim: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
    editHistory: [editHistorySchema],
    isHighlighted: { type: Boolean, default: true },
  },
  { timestamps: true }
);

superAdminRemarkSchema.index({ lead: 1, createdAt: -1 });

const SuperAdminRemark = mongoose.model('SuperAdminRemark', superAdminRemarkSchema);
export default SuperAdminRemark;
