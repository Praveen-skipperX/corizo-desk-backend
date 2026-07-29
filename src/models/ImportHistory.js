import mongoose from 'mongoose';

const importErrorSchema = new mongoose.Schema(
  {
    row: Number,
    field: String,
    message: String,
    value: String,
  },
  { _id: false }
);

const importHistorySchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    fileSize: Number,
    importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'partial'],
      default: 'pending',
      index: true,
    },
    totalRows: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },
    errors: [importErrorSchema],
    jobId: String,
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

const ImportHistory = mongoose.model('ImportHistory', importHistorySchema);
export default ImportHistory;
