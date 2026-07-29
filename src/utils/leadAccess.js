import { AppError } from './apiResponse.js';
import { ROLES } from '../constants/index.js';

export const buildLeadScopeFilter = (user) => {
  if (!user) return { _id: null };

  if (user.role === ROLES.SUPER_ADMIN) {
    return {};
  }

  if (user.role === ROLES.ADMIN) {
    const deptId = user.department?._id || user.department;
    if (!deptId) return { _id: null };
    return { department: deptId };
  }

  if (user.role === ROLES.EMPLOYEE) {
    const sheetIds = (user.allowedConnectors || [])
      .map((c) => (c?._id || c)?.toString?.() || String(c))
      .filter(Boolean);

    // Sheet ACL: leads from selected sheets OR leads assigned to this user.
    if (sheetIds.length) {
      return {
        $or: [
          { assignedTo: user._id },
          { 'importMeta.connectorId': { $in: sheetIds } },
        ],
      };
    }

    // Legacy employees without sheet ACL — created or assigned.
    return {
      $or: [
        { createdBy: user._id },
        { assignedTo: user._id },
      ],
    };
  }

  return { _id: null };
};

export const canAccessLead = (user, lead) => {
  if (!user || !lead || lead.isDeleted) return false;

  if (user.role === ROLES.SUPER_ADMIN) return true;

  if (user.role === ROLES.ADMIN) {
    const adminDept = user.department?._id?.toString() || user.department?.toString();
    const leadDept = lead.department?._id?.toString() || lead.department?.toString();
    return adminDept === leadDept;
  }

  if (user.role === ROLES.EMPLOYEE) {
    const userId = user._id.toString();
    const createdBy = lead.createdBy?._id?.toString() || lead.createdBy?.toString();
    const assignedTo = lead.assignedTo?._id?.toString() || lead.assignedTo?.toString();
    if (assignedTo === userId) return true;

    const sheetIds = (user.allowedConnectors || [])
      .map((c) => (c?._id || c)?.toString?.() || String(c))
      .filter(Boolean);

    if (sheetIds.length) {
      const connectorId = lead.importMeta?.connectorId != null
        ? String(lead.importMeta.connectorId)
        : '';
      return Boolean(connectorId && sheetIds.includes(connectorId));
    }

    return createdBy === userId;
  }

  return false;
};

export const assertCanAccessLead = (user, lead) => {
  if (!lead || lead.isDeleted) {
    throw new AppError('Lead not found', 404);
  }
  if (!canAccessLead(user, lead)) {
    throw new AppError('Access denied', 403, 'FORBIDDEN');
  }
};

export const mergeLeadScope = (user, baseFilter = {}) => {
  const scope = buildLeadScopeFilter(user);
  if (scope._id === null) {
    return { ...baseFilter, _id: null };
  }
  if (!Object.keys(scope).length) {
    return { ...baseFilter };
  }
  // Avoid clobbering when both sides use $or / $and
  if (baseFilter.$or || scope.$or || baseFilter.$and || scope.$and) {
    const parts = [baseFilter, scope].filter((f) => f && Object.keys(f).length);
    return parts.length === 1 ? parts[0] : { $and: parts };
  }
  return { ...baseFilter, ...scope };
};

export const getAccessibleLeadIds = async (user, Lead) => {
  const filter = mergeLeadScope(user, { isDeleted: false });
  const rows = await Lead.find(filter).select('_id').lean();
  return rows.map((r) => r._id);
};

export const assertAdminDepartment = (user, lead) => {
  if (user.role !== ROLES.ADMIN) return;
  const adminDept = user.department?._id?.toString() || user.department?.toString();
  const leadDept = lead.department?._id?.toString() || lead.department?.toString();
  if (adminDept !== leadDept) {
    throw new AppError('Access denied', 403, 'FORBIDDEN');
  }
};

export const loadLeadOrFail = async (id, Lead) => {
  const lead = await Lead.findById(id);
  if (!lead || lead.isDeleted) {
    throw new AppError('Lead not found', 404);
  }
  return lead;
};

export const assertLeadAccess = async (user, id, Lead) => {
  const lead = await loadLeadOrFail(id, Lead);
  assertCanAccessLead(user, lead);
  return lead;
};
