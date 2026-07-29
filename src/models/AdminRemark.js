import mongoose from 'mongoose';

const adminRemarkSchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    content: { type: String, required: true, trim: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorName: { type: String, required: true },
    authorRole: { type: String, required: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    departmentName: String,
  },
  { timestamps: true }
);

adminRemarkSchema.index({ lead: 1, createdAt: -1 });

const AdminRemark = mongoose.model('AdminRemark', adminRemarkSchema);
export default AdminRemark;
