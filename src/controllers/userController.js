import { AppError, asyncHandler, successResponse, paginatedResponse } from '../utils/apiResponse.js';

import { buildPagination, parseSort, sanitizeUser, resolveDepartmentId } from '../utils/helpers.js';

import { validatePasswordStrength, assertPasswordsMatch } from '../utils/password.js';

import { User, Department, Lead, Connector } from '../models/index.js';

import { ROLES } from '../constants/index.js';

import { logActivity, ACTIVITY_ACTIONS, ENTITY_TYPES } from '../services/auditService.js';

import { resetLoginAttempts } from '../services/redisService.js';

import { addEmailJob } from '../queues/index.js';

import { sendAccountCreatedEmail } from '../services/emailService.js';

import config from '../config/index.js';

import logger from '../utils/logger.js';

import {

  assertCanManageUser,

  buildUserListFilter,

  canSoftDeleteUser,

} from '../utils/userPermissions.js';



const resolvePasswordOptions = (body) => {

  const mode = body.passwordMode

    || (body.forcePasswordOnFirstLogin ? 'first_login' : null)

    || (body.forcePasswordChangeOnFirstLogin || body.password ? 'hybrid' : 'first_login');



  if (mode === 'first_login' || body.forcePasswordOnFirstLogin) {

    return {

      password: undefined,

      mustSetPasswordOnFirstLogin: true,

      mustChangePassword: false,

      emailMode: 'first_login',

    };

  }



  if (mode === 'manual') {

    assertPasswordsMatch(body.password, body.confirmPassword);

    validatePasswordStrength(body.password);

    return {

      password: body.password,

      mustSetPasswordOnFirstLogin: false,

      mustChangePassword: false,

      emailMode: 'manual',

    };

  }



  // hybrid (default when password provided)

  assertPasswordsMatch(body.password, body.confirmPassword);

  validatePasswordStrength(body.password);

  return {

    password: body.password,

    mustSetPasswordOnFirstLogin: false,

    mustChangePassword: true,

    emailMode: 'hybrid',

  };

};



/** Validate connector IDs are in the manager's scope. */
const resolveAllowedConnectors = async (manager, role, ids, { requireAtLeastOne = true } = {}) => {
  if (role !== ROLES.EMPLOYEE) return [];

  const unique = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!unique.length) {
    if (requireAtLeastOne) {
      throw new AppError('Select at least one sheet this employee can access', 400);
    }
    return [];
  }

  const filter = { _id: { $in: unique }, isDeleted: false };
  if (manager.role === ROLES.ADMIN) {
    filter.department = manager.department?._id || manager.department;
  }

  const found = await Connector.find(filter).select('_id');
  if (found.length !== unique.length) {
    throw new AppError('One or more selected sheets are invalid or out of your scope', 400);
  }
  return found.map((c) => c._id);
};



export const createUser = asyncHandler(async (req, res) => {

  const { name, email, phone, role, department } = req.body;



  if (req.user.role === ROLES.ADMIN && role !== ROLES.EMPLOYEE) {

    throw new AppError('Admins can only create employees', 403);

  }



  let deptId = req.user.role === ROLES.ADMIN
    ? req.user.department?._id || req.user.department
    : department;

  deptId = await resolveDepartmentId(Department, deptId);

  if (!deptId && role !== ROLES.SUPER_ADMIN) {
    throw new AppError('No active department available. Create one or contact support.', 400);
  }

  let deptDoc = null;

  if (deptId) {
    deptDoc = await Department.findById(deptId);
    if (!deptDoc?.isActive) throw new AppError('Invalid department', 400);
  }



  const existing = await User.findOne({ email: email.toLowerCase(), deletedAt: null });

  if (existing) throw new AppError('Email already exists', 409);



  const passwordOptions = resolvePasswordOptions(req.body);

  const allowedConnectors = await resolveAllowedConnectors(
    req.user,
    role,
    req.body.allowedConnectors,
  );



  const user = await User.create({

    name,

    email: email.toLowerCase(),

    phone,

    role,

    department: deptId,

    allowedConnectors,

    createdBy: req.user._id,

    password: passwordOptions.password,

    mustSetPasswordOnFirstLogin: passwordOptions.mustSetPasswordOnFirstLogin,

    mustChangePassword: passwordOptions.mustChangePassword,

    passwordSetAt: passwordOptions.password ? new Date() : undefined,

    isActive: req.body.isActive !== false,

  });



  try {

    await sendAccountCreatedEmail({

      email: user.email,

      name: user.name,

      role: user.role,

      departmentName: deptDoc?.name,

      loginUrl: `${config.frontendUrl}/login`,

      passwordMode: passwordOptions.emailMode,

      temporaryPassword: passwordOptions.emailMode !== 'first_login' ? req.body.password : undefined,

    });

  } catch (err) {

    logger.error('Account creation email failed:', err.message);

    await addEmailJob({

      type: 'account_created',

      email: user.email,

      name: user.name,

      role: user.role,

      departmentName: deptDoc?.name,

      loginUrl: `${config.frontendUrl}/login`,

      passwordMode: passwordOptions.emailMode,

    });

  }



  await logActivity({

    user: req.user,

    action: ACTIVITY_ACTIONS.USER_CREATE,

    entityType: ENTITY_TYPES.USER,

    entityId: user._id,

    updatedValues: {

      name,

      email,

      role,

      passwordMode: passwordOptions.emailMode,

    },

    ipAddress: req.clientIp,

    deviceInfo: req.deviceInfo,

  });



  const populated = await User.findById(user._id)
    .populate('department', 'name code')
    .populate('allowedConnectors', 'name type status');
  successResponse(res, sanitizeUser(populated), 'User created', 201);
});

export const getUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sortBy, sortOrder, ...filters } = req.query;
  const filter = buildUserListFilter(req.user, filters);

  const skip = (page - 1) * limit;
  const [users, total] = await Promise.all([
    User.find(filter)
      .populate('department', 'name code')
      .populate('allowedConnectors', 'name type status')
      .populate('createdBy', 'name email')
      .sort(parseSort(sortBy, sortOrder))
      .skip(skip)
      .limit(Number(limit)),
    User.countDocuments(filter),
  ]);

  paginatedResponse(res, users.map(sanitizeUser), buildPagination(page, limit, total));
});

export const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .populate('department', 'name code')
    .populate('allowedConnectors', 'name type status');
  if (!user || user.deletedAt) throw new AppError('User not found', 404);

  if (req.user._id.toString() !== user._id.toString()) {
    assertCanManageUser(req.user, user);
  }

  successResponse(res, sanitizeUser(user));
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || user.deletedAt) throw new AppError('User not found', 404);

  assertCanManageUser(req.user, user);

  const allowedFields = ['name', 'phone', 'department', 'isActive'];
  if (req.user.role === ROLES.SUPER_ADMIN) allowedFields.push('role');

  const previousValues = {
    name: user.name,
    phone: user.phone,
    isActive: user.isActive,
    department: user.department,
    allowedConnectors: user.allowedConnectors,
  };
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) user[key] = req.body[key];
  }

  const nextRole = req.body.role !== undefined ? req.body.role : user.role;
  if (req.body.allowedConnectors !== undefined || req.body.role !== undefined) {
    if (nextRole === ROLES.EMPLOYEE) {
      user.allowedConnectors = await resolveAllowedConnectors(
        req.user,
        ROLES.EMPLOYEE,
        req.body.allowedConnectors !== undefined
          ? req.body.allowedConnectors
          : (user.allowedConnectors || []).map((c) => c?._id || c),
        { requireAtLeastOne: true },
      );
    } else {
      user.allowedConnectors = [];
    }
  }

  await user.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.USER_UPDATE,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    previousValues,
    updatedValues: req.body,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  const updated = await User.findById(user._id)
    .populate('department', 'name code')
    .populate('allowedConnectors', 'name type status');
  successResponse(res, sanitizeUser(updated), 'User updated');
});

export const reactivateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);

  assertCanManageUser(req.user, user);

  user.isActive = true;
  user.deletedAt = null;
  await user.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.USER_UPDATE,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    updatedValues: { isActive: true },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, sanitizeUser(user), 'User reactivated');
});

export const deactivateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  if (user.role === ROLES.SUPER_ADMIN) throw new AppError('Cannot deactivate Super Admin', 403);

  assertCanManageUser(req.user, user);

  user.isActive = false;
  await user.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.USER_DEACTIVATE,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, null, 'User deactivated');
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);

  assertCanManageUser(req.user, user);

  const { allowed, reason } = await canSoftDeleteUser(user._id);
  if (!allowed) {
    user.isActive = false;
    await user.save();
    throw new AppError(reason, 409, 'SOFT_DELETE_ONLY');
  }

  user.isActive = false;
  user.deletedAt = new Date();
  await user.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.DELETE,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, null, 'User deleted');
});

export const resetUserPassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user || user.deletedAt) throw new AppError('User not found', 404);
  if (user.role === ROLES.SUPER_ADMIN) {
    throw new AppError('Cannot reset Super Admin password through this action', 403);
  }

  assertCanManageUser(req.user, user);

  const { password, confirmPassword } = req.body;
  assertPasswordsMatch(password, confirmPassword);
  validatePasswordStrength(password);

  user.password = password;
  user.mustSetPasswordOnFirstLogin = false;
  user.mustChangePassword = true;
  user.passwordSetAt = new Date();
  await user.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.USER_UPDATE,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    metadata: { action: 'admin_password_reset', requireChangeOnLogin: true },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, sanitizeUser(user), 'Password reset. User must update password on next login.');
});

export const unlockUserAccount = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);

  if (req.user.role === ROLES.ADMIN) {
    assertCanManageUser(req.user, user);
  } else if (req.user.role !== ROLES.SUPER_ADMIN) {
    throw new AppError('Access denied', 403);
  }

  user.isLocked = false;
  user.lockedAt = undefined;
  user.lockedReason = undefined;
  await user.save();
  await resetLoginAttempts(user.email);

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.ACCOUNT_UNLOCK,
    entityType: ENTITY_TYPES.USER,
    entityId: user._id,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, sanitizeUser(user), 'Account unlocked');
});

export const createDepartment = asyncHandler(async (req, res) => {
  const { name, code, description } = req.body;

  const existing = await Department.findOne({ $or: [{ name }, { code: code.toUpperCase() }] });
  if (existing) throw new AppError('Department already exists', 409);

  const department = await Department.create({
    name,
    code: code.toUpperCase(),
    description,
    createdBy: req.user._id,
  });

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.CREATE,
    entityType: ENTITY_TYPES.DEPARTMENT,
    entityId: department._id,
    updatedValues: { name, code },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, department, 'Department created', 201);
});

export const getDepartments = asyncHandler(async (req, res) => {
  const filter = { deletedAt: null };
  if (req.query.activeOnly === 'true') filter.isActive = true;
  if (req.query.includeDeleted === 'true' && req.user.role === ROLES.SUPER_ADMIN) {
    delete filter.deletedAt;
  }

  const departments = await Department.find(filter)
    .populate('head', 'name email')
    .sort({ name: 1 })
    .lean();

  const deptIds = departments.map((d) => d._id);
  const [userCounts, leadCounts] = await Promise.all([
    User.aggregate([
      { $match: { department: { $in: deptIds }, deletedAt: null, isActive: true } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
    ]),
    Lead.aggregate([
      { $match: { department: { $in: deptIds }, isDeleted: false } },
      { $group: { _id: '$department', count: { $sum: 1 } } },
    ]),
  ]);

  const userMap = Object.fromEntries(userCounts.map((u) => [u._id.toString(), u.count]));
  const leadMap = Object.fromEntries(leadCounts.map((i) => [i._id.toString(), i.count]));

  const enriched = departments.map((d) => ({
    ...d,
    totalUsers: userMap[d._id.toString()] || 0,
    totalLeads: leadMap[d._id.toString()] || 0,
  }));

  successResponse(res, enriched);
});

export const getDepartmentById = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id).populate('head', 'name email');
  if (!department || department.deletedAt) throw new AppError('Department not found', 404);

  const [totalUsers, totalLeads] = await Promise.all([
    User.countDocuments({ department: department._id, deletedAt: null, isActive: true }),
    Lead.countDocuments({ department: department._id, isDeleted: false }),
  ]);

  successResponse(res, { ...department.toObject(), totalUsers, totalLeads });
});

export const deactivateDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department || department.deletedAt) throw new AppError('Department not found', 404);

  department.isActive = false;
  await department.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.UPDATE,
    entityType: ENTITY_TYPES.DEPARTMENT,
    entityId: department._id,
    updatedValues: { isActive: false },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, department, 'Department deactivated');
});

export const reactivateDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department || department.deletedAt) throw new AppError('Department not found', 404);

  department.isActive = true;
  await department.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.UPDATE,
    entityType: ENTITY_TYPES.DEPARTMENT,
    entityId: department._id,
    updatedValues: { isActive: true },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, department, 'Department reactivated');
});

export const deleteDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department || department.deletedAt) throw new AppError('Department not found', 404);

  const [activeUsers, activeLeads] = await Promise.all([
    User.countDocuments({ department: department._id, deletedAt: null, isActive: true }),
    Lead.countDocuments({ department: department._id, isDeleted: false }),
  ]);

  if (activeUsers > 0 || activeLeads > 0) {
    department.isActive = false;
    await department.save();
    throw new AppError(
      `Cannot delete department with ${activeUsers} active user(s) and ${activeLeads} active lead(s). Department has been deactivated instead.`,
      409,
      'DEPT_HAS_DEPENDENCIES'
    );
  }

  department.isActive = false;
  department.deletedAt = new Date();
  await department.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.DELETE,
    entityType: ENTITY_TYPES.DEPARTMENT,
    entityId: department._id,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, null, 'Department deleted');
});

export const updateDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department || department.deletedAt) throw new AppError('Department not found', 404);

  const previousValues = { name: department.name, isActive: department.isActive };
  Object.assign(department, req.body);
  await department.save();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.UPDATE,
    entityType: ENTITY_TYPES.DEPARTMENT,
    entityId: department._id,
    previousValues,
    updatedValues: req.body,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, department, 'Department updated');
});

export const getLockedAccounts = asyncHandler(async (req, res) => {
  const filter = { isLocked: true, deletedAt: null };
  if (req.user.role === ROLES.SUPER_ADMIN) {
    filter.createdBy = req.user._id;
  } else if (req.user.role === ROLES.ADMIN) {
    filter.createdBy = req.user._id;
    filter.department = req.user.department._id || req.user.department;
  }

  const users = await User.find(filter)
    .populate('department', 'name code')
    .select('-password');

  successResponse(res, users.map(sanitizeUser));
});