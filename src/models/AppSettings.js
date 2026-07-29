import mongoose from 'mongoose';

/**
 * Singleton application settings (key = 'default').
 * Feature flags live here so admins can toggle without redeploy.
 */
const appSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    /**
     * When false, Admin Remarks are hidden in the UI and new admin remarks
     * cannot be created. Existing data is retained.
     */
    adminRemarksEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const AppSettings = mongoose.model('AppSettings', appSettingsSchema);
export default AppSettings;
