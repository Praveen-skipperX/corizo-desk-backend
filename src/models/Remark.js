import mongoose from 'mongoose';

const remarkSchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    content: { type: String, required: true, trim: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorRole: { type: String, required: true },
    authorName: { type: String, required: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    isInternal: { type: Boolean, default: false },
    isImmutable: { type: Boolean, default: true },
  },
  { timestamps: true }
);

remarkSchema.index({ lead: 1, createdAt: -1 });

const Remark = mongoose.model('Remark', remarkSchema);
export default Remark;
