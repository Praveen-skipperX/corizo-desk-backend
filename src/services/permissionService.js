import Permission from '../models/Permission.js';
import Role from '../models/Role.js';
import RolePermission from '../models/RolePermission.js';
import {
  PERMISSION_CATALOG,
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
} from '../constants/permissions.js';
import logger from '../utils/logger.js';

/**
 * Resolve permissions for a user by role slug (users.role).
 * Returns [{ key, scope }]
 */
export const getPermissionsForRoleSlug = async (roleSlug) => {
  if (!roleSlug) return [];

  const role = await Role.findOne({ slug: roleSlug, isActive: true }).lean();
  if (!role) {
    // Fallback: empty until seeded — callers may use legacy role checks during migration
    return [];
  }

  const grants = await RolePermission.find({ role: role._id })
    .select('permissionKey scope')
    .lean();

  return grants.map((g) => ({ key: g.permissionKey, scope: g.scope }));
};

export const getPermissionKeysForRoleSlug = async (roleSlug) => {
  const grants = await getPermissionsForRoleSlug(roleSlug);
  return grants.map((g) => g.key);
};

export const roleHasPermission = async (roleSlug, permissionKey) => {
  const keys = await getPermissionKeysForRoleSlug(roleSlug);
  return keys.includes(permissionKey);
};

export const userHasPermission = async (user, permissionKey) => {
  if (!user?.role) return false;
  return roleHasPermission(user.role, permissionKey);
};

export const getPermissionScope = async (roleSlug, permissionKey) => {
  const grants = await getPermissionsForRoleSlug(roleSlug);
  return grants.find((g) => g.key === permissionKey)?.scope || null;
};

/**
 * Seed/upsert permission catalog, system roles, and default matrix.
 * Idempotent — safe to re-run.
 */
export const seedRbac = async () => {
  const permissionIdsByKey = {};

  for (const item of PERMISSION_CATALOG) {
    const doc = await Permission.findOneAndUpdate(
      { key: item.key },
      {
        $set: {
          module: item.module,
          action: item.action,
          description: item.description,
          isActive: true,
        },
      },
      { upsert: true, new: true }
    );
    permissionIdsByKey[item.key] = doc._id;
  }

  const roleIdsBySlug = {};
  for (const item of SYSTEM_ROLES) {
    const doc = await Role.findOneAndUpdate(
      { slug: item.slug },
      {
        $set: {
          name: item.name,
          description: item.description,
          isSystem: item.isSystem,
          isActive: true,
        },
      },
      { upsert: true, new: true }
    );
    roleIdsBySlug[item.slug] = doc._id;
  }

  for (const [slug, grants] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const roleId = roleIdsBySlug[slug];
    if (!roleId) continue;

    const desiredKeys = new Set(grants.map((g) => g.key));

    // Upsert grants
    for (const grant of grants) {
      const permissionId = permissionIdsByKey[grant.key];
      if (!permissionId) {
        logger.warn(`RBAC seed: unknown permission key ${grant.key}`);
        continue;
      }
      await RolePermission.findOneAndUpdate(
        { role: roleId, permission: permissionId },
        {
          $set: {
            permissionKey: grant.key,
            scope: grant.scope,
          },
        },
        { upsert: true }
      );
    }

    // Remove grants no longer in default matrix for system roles (keeps seed as source of truth for system roles)
    await RolePermission.deleteMany({
      role: roleId,
      permissionKey: { $nin: [...desiredKeys] },
    });
  }

  logger.info('RBAC seed completed', {
    permissions: PERMISSION_CATALOG.length,
    roles: SYSTEM_ROLES.length,
  });

  return {
    permissions: PERMISSION_CATALOG.length,
    roles: SYSTEM_ROLES.length,
  };
};

export default {
  getPermissionsForRoleSlug,
  getPermissionKeysForRoleSlug,
  roleHasPermission,
  userHasPermission,
  getPermissionScope,
  seedRbac,
};
