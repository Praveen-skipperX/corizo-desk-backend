import mongoose from 'mongoose';
import { CONNECTOR_TYPES } from '../constants/index.js';

const fieldMappingSchema = new mongoose.Schema(
  {
    sourceColumn: { type: String, required: true, trim: true },
    targetField: { type: String, required: true, trim: true },
    required: { type: Boolean, default: false },
    customKey: { type: String, trim: true },
    customLabel: { type: String, trim: true },
  },
  { _id: false }
);

const mappingTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    connectorType: {
      type: String,
      enum: Object.values(CONNECTOR_TYPES),
      default: CONNECTOR_TYPES.GOOGLE_SHEETS,
      index: true,
    },
    fieldMapping: { type: [fieldMappingSchema], default: [] },
    uniqueKeyColumn: { type: String, trim: true },
    headerRow: { type: Number, default: 1 },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

mappingTemplateSchema.index({ name: 1, connectorType: 1, isDeleted: 1 });

const MappingTemplate = mongoose.model('MappingTemplate', mappingTemplateSchema);
export default MappingTemplate;
