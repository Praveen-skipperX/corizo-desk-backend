import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    deletedAt: { type: Date, default: null, index: true },
    head: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

departmentSchema.index({ name: 1, isActive: 1 });

const Department = mongoose.model('Department', departmentSchema);
export default Department;
