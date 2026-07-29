import mongoose from 'mongoose';

const leadAssignmentSchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    previousAssignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    previousDepartment: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    type: {
      type: String,
      enum: ['assign', 'reassign', 'transfer'],
      default: 'assign',
    },
    notes: String,
    reason: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

leadAssignmentSchema.index({ lead: 1, createdAt: -1 });

const LeadAssignment = mongoose.model('LeadAssignment', leadAssignmentSchema);
export default LeadAssignment;
