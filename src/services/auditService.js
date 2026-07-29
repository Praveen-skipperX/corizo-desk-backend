import { ActivityLog } from '../models/index.js';
import { ACTIVITY_ACTIONS, ENTITY_TYPES } from '../constants/index.js';

export const logActivity = async ({
  user,
  action,
  entityType,
  entityId,
  previousValues = null,
  updatedValues = null,
  ipAddress,
  deviceInfo,
  metadata = null,
}) => {
  const log = await ActivityLog.create({
    user: user?._id || user?.id,
    userName: user?.name || 'System',
    userRole: user?.role || 'system',
    department: user?.department?._id || user?.department,
    action,
    entityType,
    entityId: entityId?.toString(),
    previousValues,
    updatedValues,
    ipAddress,
    deviceInfo,
    metadata,
  });
  return log;
};

export const buildActivityContext = (req, user) => ({
  user,
  ipAddress: req.clientIp,
  deviceInfo: req.deviceInfo,
});

export { ACTIVITY_ACTIONS, ENTITY_TYPES };
