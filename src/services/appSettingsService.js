import { AppSettings } from '../models/index.js';

const DEFAULTS = {
  key: 'default',
  adminRemarksEnabled: false,
};

export async function getAppSettings() {
  let doc = await AppSettings.findOne({ key: 'default' });
  if (!doc) {
    doc = await AppSettings.create({ ...DEFAULTS });
  }
  return doc;
}

export async function isAdminRemarksEnabled() {
  const settings = await getAppSettings();
  return Boolean(settings.adminRemarksEnabled);
}

export async function updateAppSettings(patch = {}) {
  const allowed = {};
  if (typeof patch.adminRemarksEnabled === 'boolean') {
    allowed.adminRemarksEnabled = patch.adminRemarksEnabled;
  }

  const doc = await AppSettings.findOneAndUpdate(
    { key: 'default' },
    { $set: { ...DEFAULTS, ...allowed } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return doc;
}
