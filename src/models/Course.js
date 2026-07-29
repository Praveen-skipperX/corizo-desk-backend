import mongoose from 'mongoose';

const courseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    category: { type: String, trim: true, index: true },
    description: { type: String, trim: true },
    sortOrder: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
    deletedAt: { type: Date, default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

courseSchema.index({ name: 1, isActive: 1 });
courseSchema.index({ category: 1, sortOrder: 1 });

const Course = mongoose.model('Course', courseSchema);
export default Course;
