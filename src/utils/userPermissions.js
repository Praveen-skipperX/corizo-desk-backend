import { AppError } from '../utils/apiResponse.js';
import { ROLES } from '../constants/index.js';
import { Lead, ActivityLog } from '../models/index.js';

export const canManageUser = (manager, target) => {
  if (!target || target.role === ROLES.SUPER_ADMIN) return false;
  if (manager.role === ROLES.SUPER_ADMIN) {
    return target.createdBy?.toString() === manager._id.toString();
  }
  if (manager.role === ROLES.ADMIN) {
    const adminDept = manager.department?._id?.toString() || manager.department?.toString();
    const targetDept = target.department?._id?.toString() || target.department?.toString();
    return (
      target.role === ROLES.EMPLOYEE &&
      target.createdBy?.toString() === manager._id.toString() &&
      adminDept === targetDept
    );
  }
  return false;
};

export const assertCanManageUser = (manager, target) => {
  if (!canManageUser(manager, target)) {
    throw new AppError('You can only manage users created by you', 403, 'FORBIDDEN');
  }
};

export const buildUserListFilter = (user, query = {}) => {
  const filter = { role: { $ne: ROLES.SUPER_ADMIN }, deletedAt: null };

  if (user.role === ROLES.SUPER_ADMIN) {
    filter.createdBy = user._id;
  } else if (user.role === ROLES.ADMIN) {
    filter.createdBy = user._id;
    filter.role = ROLES.EMPLOYEE;
    filter.department = user.department._id || user.department;
  }

  if (query.role && user.role === ROLES.SUPER_ADMIN) filter.role = query.role;
  if (query.department && user.role === ROLES.SUPER_ADMIN) filter.department = query.department;
  if (query.includeInactive === 'true') {
    delete filter.deletedAt;
  }

  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { email: { $regex: query.search, $options: 'i' } },
    ];
  }

  return filter;
};

export const canSoftDeleteUser = async (userId) => {
  const [leadCount, activityCount] = await Promise.all([
    Lead.countDocuments({
      $or: [{ createdBy: userId }, { assignedTo: userId }],
      isDeleted: false,
    }),
    ActivityLog.countDocuments({ user: userId }),
  ]);

  if (leadCount > 0 || activityCount > 0) {
    return { allowed: false, reason: 'User has associated inquiries or activity logs. Use deactivate instead.' };
  }
  return { allowed: true };
};
