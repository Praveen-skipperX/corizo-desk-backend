import mongoose from 'mongoose';

const dealClosureSchema = new mongoose.Schema(
  {
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, unique: true, index: true },
    leadRef: { type: String, required: true },
    name: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    closureDate: { type: Date, required: true, index: true },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    notes: String,
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['active', 'cancelled'], default: 'active', index: true },
    cancelledAt: Date,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancellationReason: String,
  },
  { timestamps: true }
);

dealClosureSchema.index({ department: 1, closureDate: -1 });
dealClosureSchema.index({ closedBy: 1, closureDate: -1 });

const DealClosure = mongoose.model('DealClosure', dealClosureSchema);
export default DealClosure;
