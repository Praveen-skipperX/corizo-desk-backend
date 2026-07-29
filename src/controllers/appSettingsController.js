import { AppError, asyncHandler, successResponse } from '../utils/apiResponse.js';
import { getAppSettings, updateAppSettings } from '../services/appSettingsService.js';
import { ROLES } from '../constants/index.js';

const assertAdmin = (user) => {
  if (![ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(user?.role)) {
    throw new AppError('Only admins can manage app settings', 403, 'FORBIDDEN');
  }
};

export const getSystemAppSettings = asyncHandler(async (req, res) => {
  const settings = await getAppSettings();
  successResponse(res, {
    adminRemarksEnabled: Boolean(settings.adminRemarksEnabled),
    updatedAt: settings.updatedAt,
  });
});

export const updateSystemAppSettings = asyncHandler(async (req, res) => {
  assertAdmin(req.user);
  const settings = await updateAppSettings({
    adminRemarksEnabled: req.body?.adminRemarksEnabled,
  });
  successResponse(res, {
    adminRemarksEnabled: Boolean(settings.adminRemarksEnabled),
    updatedAt: settings.updatedAt,
  }, 'App settings updated');
});
