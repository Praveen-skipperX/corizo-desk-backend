import { AppError } from '../utils/apiResponse.js';
import { verifyAccessToken, getSession, touchSession } from '../services/redisService.js';
import { User } from '../models/index.js';
import { ROLES } from '../constants/index.js';
import { buildLeadScopeFilter, canAccessLead, assertCanAccessLead } from '../utils/leadAccess.js';
import { loadPermissions, requirePermission } from './permissions.js';

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const session = await getSession(decoded.sessionId);
    if (!session) {
      throw new AppError('Session expired', 401, 'SESSION_EXPIRED');
    }

    // Sliding session — keep this device trusted while the user is active
    await touchSession(decoded.sessionId);

    const user = await User.findById(decoded.userId)
      .populate('department', 'name code isActive')
      .select('-password');

    if (!user || !user.isActive) {
      throw new AppError('User not found or inactive', 401, 'USER_INACTIVE');
    }

    if (user.isLocked) {
      throw new AppError('Account is locked', 403, 'ACCOUNT_LOCKED');
    }

    req.user = user;
    req.sessionId = decoded.sessionId;
    return loadPermissions(req, res, next);
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(new AppError('Invalid or expired token', 401, 'INVALID_TOKEN'));
    }
    next(error);
  }
};

export const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }
  if (!roles.includes(req.user.role)) {
    return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
  }
  next();
};

export { loadPermissions, requirePermission };

export const departmentScope = (req, res, next) => {
  if (req.user.role === ROLES.SUPER_ADMIN) {
    req.departmentFilter = {};
    return next();
  }

  if (!req.user.department) {
    return next(new AppError('No department assigned', 403, 'NO_DEPARTMENT'));
  }

  req.departmentFilter = { department: req.user.department._id || req.user.department };
  next();
};

export const employeeScope = (req, res, next) => {
  req.leadFilter = buildLeadScopeFilter(req.user);
  next();
};

export { canAccessLead, assertCanAccessLead, buildLeadScopeFilter };

export const activityLogScope = (req, res, next) => {
  if (req.user.role === ROLES.SUPER_ADMIN) {
    req.activityFilter = {};
  } else if (req.user.role === ROLES.ADMIN) {
    req.activityFilter = { department: req.user.department._id || req.user.department };
  } else {
    req.activityFilter = { user: req.user._id };
  }
  next();
};
