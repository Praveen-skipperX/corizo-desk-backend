import { AppError } from '../utils/apiResponse.js';
import { getPermissionsForRoleSlug } from '../services/permissionService.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../constants/permissions.js';

/**
 * Attach req.permissions = [{ key, scope }] for the authenticated user.
 * Falls back to in-code DEFAULT_ROLE_PERMISSIONS if DB not seeded yet.
 */
export const loadPermissions = async (req, res, next) => {
  try {
    if (!req.user?.role) {
      req.permissions = [];
      req.permissionKeys = new Set();
      return next();
    }

    let permissions = await getPermissionsForRoleSlug(req.user.role);

    if (!permissions.length && DEFAULT_ROLE_PERMISSIONS[req.user.role]) {
      permissions = DEFAULT_ROLE_PERMISSIONS[req.user.role].map((g) => ({
        key: g.key,
        scope: g.scope,
      }));
    }

    req.permissions = permissions;
    req.permissionKeys = new Set(permissions.map((p) => p.key));
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Require one or more permission keys (ANY match by default).
 * Usage: requirePermission('leads.view')
 *        requirePermission('leads.edit', 'leads.assign') // any
 *        requirePermission({ all: ['leads.view', 'leads.edit'] })
 */
export const requirePermission = (...args) => {
  const options = typeof args[args.length - 1] === 'object' && !Array.isArray(args[args.length - 1])
    && (args[args.length - 1].all || args[args.length - 1].any)
    ? args.pop()
    : null;

  const keys = args.flat();

  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    }

    const granted = req.permissionKeys || new Set();

    if (options?.all) {
      const missing = options.all.filter((k) => !granted.has(k));
      if (missing.length) {
        return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
      }
      return next();
    }

    const required = options?.any || keys;
    if (!required.length) return next();

    const ok = required.some((k) => granted.has(k));
    if (!ok) {
      return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
    }
    next();
  };
};

export const getPermissionScopeFromRequest = (req, permissionKey) => {
  const grant = (req.permissions || []).find((p) => p.key === permissionKey);
  return grant?.scope || null;
};

export default { loadPermissions, requirePermission, getPermissionScopeFromRequest };
