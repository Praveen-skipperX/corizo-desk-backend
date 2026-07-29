import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

const Role = mongoose.model('Role', roleSchema);
export default Role;
