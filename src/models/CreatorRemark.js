import mongoose from 'mongoose';

const editHistorySchema = new mongoose.Schema(
  {
    content: String,
    editedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const creatorRemarkSchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    content: { type: String, required: true, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, required: true },
    /** Status this remark is associated with (current or newly set). */
    relatedStatus: { type: String, trim: true, index: true },
    /** Previous status when this remark was saved with a status change. */
    previousStatus: { type: String, trim: true },
    editHistory: [editHistorySchema],
    isLatest: { type: Boolean, default: true },
  },
  { timestamps: true }
);

creatorRemarkSchema.index({ lead: 1, createdAt: -1 });

const CreatorRemark = mongoose.model('CreatorRemark', creatorRemarkSchema);
export default CreatorRemark;
