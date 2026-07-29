import mongoose from 'mongoose';

const exportLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    exportType: { type: String, default: 'lead' },
    format: { type: String, enum: ['excel', 'csv', 'pdf'], required: true },
    fields: [String],
    recordCount: { type: Number, default: 0 },
    filters: mongoose.Schema.Types.Mixed,
    ipAddress: String,
    deviceInfo: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

const ExportLog = mongoose.model('ExportLog', exportLogSchema);
export default ExportLog;
