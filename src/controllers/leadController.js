import crypto from 'crypto';
import { AppError, asyncHandler, successResponse, paginatedResponse } from '../utils/apiResponse.js';
import {
  generateLeadId,
  buildPagination,
  parseSort,
  resolveDepartmentId,
} from '../utils/helpers.js';
import {
  Lead,
  LeadAssignment,
  DealClosure,
  Department,
  User,
  ImportHistory,
  CreatorRemark,
  AdminRemark,
  FollowUp,
  LeadTimelineEvent,
} from '../models/index.js';
import { getLeadTimelines } from './remarkController.js';
import {
  ROLES,
  LEAD_STATUSES,
  LEAD_SOURCES,
  TRANSFER_STATUSES,
  ACTIVITY_ACTIONS,
  ENTITY_TYPES,
  PRIORITY_ORDER,
} from '../constants/index.js';
import { logActivity } from '../services/auditService.js';
import {
  invalidateLeadCache,
  invalidateDashboardCache,
  invalidateAllDashboardCaches,
  cacheLead,
  getCachedLead,
} from '../services/redisService.js';
import { assertLeadAccess, mergeLeadScope } from '../utils/leadAccess.js';
import { addEmailJob, addImportJob } from '../queues/index.js';
import { normalizeCourseValue, buildCourseMatchFilter } from '../utils/customFields.js';
import { dayBoundsFromInput, resolveLeadDate } from '../utils/leadDate.js';
import { getFollowUpDayWindows } from '../utils/dateUtils.js';
import { isAdminRemarksEnabled } from '../services/appSettingsService.js';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs/promises';

const CLOSED_STATUSES = [
  LEAD_STATUSES.CLOSED,
  LEAD_STATUSES.NOT_INTERESTED,
  LEAD_STATUSES.DUPLICATE,
  LEAD_STATUSES.SPAM,
];

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const pushAndClause = (filter, clause) => {
  if (!filter.$and) filter.$and = [];
  filter.$and.push(clause);
};

/**
 * Filter by the Leads "Date" column only (denormalized leadDate).
 * Must match what the Date column displays — not createdAt/import time.
 */
const applyLeadDateRangeFilter = (filter, dateFrom, dateTo) => {
  if (!dateFrom && !dateTo) return;
  const range = dayBoundsFromInput(dateFrom, dateTo);
  if (!range) return;
  filter.leadDate = range;
};

const applyLeadQueryFilters = (filter, query = {}, user) => {
  const {
    status,
    priority,
    department,
    assignedTo,
    search,
    dateFrom,
    dateTo,
    source,
    course,
    connectorId,
  } = query;

  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (source) filter.source = source;
  if (course) {
    const courseClause = buildCourseMatchFilter(course);
    if (courseClause) pushAndClause(filter, courseClause);
  }
  if (connectorId) filter['importMeta.connectorId'] = String(connectorId);
  if (department && user?.role === ROLES.SUPER_ADMIN) filter.department = department;
  if (assignedTo) filter.assignedTo = assignedTo;

  applyLeadDateRangeFilter(filter, dateFrom, dateTo);

  if (search && String(search).trim()) {
    const q = String(search).trim();
    const escaped = escapeRegex(q);
    const phoneDigits = q.replace(/\D/g, '');
    pushAndClause(filter, {
      $or: [
        { name: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { leadId: { $regex: escaped, $options: 'i' } },
        { course: { $regex: escaped, $options: 'i' } },
        {
          phone: {
            $regex: phoneDigits.length >= 3 ? phoneDigits : escaped,
            $options: 'i',
          },
        },
      ],
    });
  }

  return filter;
};

const buildDuplicateHash = (phone, email) =>
  crypto.createHash('md5').update(`${phone}-${email || ''}`.toLowerCase()).digest('hex');

const populateLead = (query) =>
  query
    .populate('department', 'name code')
    .populate('assignedTo', 'name email phone')
    .populate('createdBy', 'name email');

export const createLead = asyncHandler(async (req, res) => {
  const data = req.body;
  let departmentId = req.user.role === ROLES.ADMIN || req.user.role === ROLES.EMPLOYEE
    ? req.user.department?._id || req.user.department
    : data.department;

  departmentId = await resolveDepartmentId(Department, departmentId);
  if (!departmentId) throw new AppError('No active department available. Create one or contact support.', 400);

  const creatorRemark = data.creatorRemark?.trim();
  if (!creatorRemark) {
    throw new AppError('Remark is required when creating a lead', 400, 'CREATOR_REMARK_REQUIRED');
  }

  const duplicateHash = buildDuplicateHash(data.phone, data.email);
  const duplicate = await Lead.findOne({ duplicateHash, isDeleted: false });
  if (duplicate) {
    throw new AppError('Duplicate lead detected', 409, 'DUPLICATE_LEAD');
  }

  const leadId = await generateLeadId(Lead);
  const { creatorRemark: remarkText, adminRemark, dealAmount, dealNotes, ...leadData } = data;

  if (leadData.nextFollowUpDate === '') delete leadData.nextFollowUpDate;
  if (leadData.course !== undefined) leadData.course = normalizeCourseValue(leadData.course);
  leadData.leadDate = resolveLeadDate(leadData) || new Date();

  const lead = await Lead.create({
    ...leadData,
    leadId,
    department: departmentId,
    createdBy: req.user._id,
    source: data.source || LEAD_SOURCES.MANUAL,
    duplicateHash,
    lastActivityAt: new Date(),
  });

  await CreatorRemark.create({
    lead: lead._id,
    content: remarkText,
    createdBy: req.user._id,
    authorName: req.user.name,
    authorRole: req.user.role,
  });

  if (
    adminRemark?.trim()
    && [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role)
    && (await isAdminRemarksEnabled())
  ) {
    await AdminRemark.create({
      lead: lead._id,
      content: adminRemark.trim(),
      addedBy: req.user._id,
      authorName: req.user.name,
      authorRole: req.user.role,
      department: req.user.department?._id || req.user.department,
      departmentName: req.user.department?.name,
    });
  }

  if (data.assignedTo) {
    await LeadAssignment.create({
      lead: lead._id,
      assignedTo: data.assignedTo,
      assignedBy: req.user._id,
      department: departmentId,
      type: 'assign',
    });

    const assignee = await User.findById(data.assignedTo);
    if (assignee?.email) {
      await addEmailJob({
        type: 'lead_assigned',
        email: assignee.email,
        name: assignee.name,
        lead: { leadId, name: data.name, priority: lead.priority, status: lead.status },
      });
    }
  }

  if (data.status === LEAD_STATUSES.CLOSED && dealAmount !== undefined) {
    await DealClosure.findOneAndUpdate(
      { lead: lead._id },
      {
        lead: lead._id,
        leadRef: leadId,
        name: data.name,
        amount: dealAmount,
        closureDate: new Date(),
        closedBy: req.user._id,
        department: departmentId,
        notes: dealNotes,
      },
      { upsert: true }
    );
    lead.dealClosure = {
      amount: dealAmount,
      closureDate: new Date(),
      closedBy: req.user._id,
      notes: dealNotes,
    };
    await lead.save();
  }

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.CREATE,
    entityType: ENTITY_TYPES.LEAD,
    entityId: lead._id,
    updatedValues: { leadId, name: data.name },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  await invalidateDashboardCache('department', departmentId);
  const populated = await populateLead(Lead.findById(lead._id));
  successResponse(res, await populated, 'Lead created', 201);
});

export const listLeads = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 30,
    search,
    status,
    priority,
    department,
    assignedTo,
    scope,
    dateFrom,
    dateTo,
    sortBy,
    sortOrder,
    source,
    course,
    connectorId,
  } = req.query;

  const pageNum = Math.max(Number(page) || 1, 1);
  const pageLimit = Math.min(Math.max(Number(limit) || 30, 1), 500);

  const filter = { isDeleted: false };

  if (req.user.role === ROLES.EMPLOYEE && scope === 'assigned') {
    filter.assignedTo = req.user._id;
  } else if (req.user.role === ROLES.EMPLOYEE && scope === 'created') {
    filter.createdBy = req.user._id;
  } else {
    Object.assign(filter, req.leadFilter);
  }

  applyLeadQueryFilters(filter, {
    status,
    priority,
    department,
    assignedTo,
    search,
    dateFrom,
    dateTo,
    source,
    course,
    connectorId,
  }, req.user);

  const skip = (pageNum - 1) * pageLimit;
  const [leads, total] = await Promise.all([
    populateLead(
      Lead.find(filter)
        .sort(parseSort(sortBy || 'createdAt', sortOrder || 'desc'))
        .skip(skip)
        .limit(pageLimit)
    ),
    Lead.countDocuments(filter),
  ]);

  paginatedResponse(res, await leads, buildPagination(pageNum, pageLimit, total));
});

export const getLead = asyncHandler(async (req, res) => {
  const leadDoc = await assertLeadAccess(req.user, req.params.id, Lead);

  const cached = await getCachedLead(req.params.id);
  if (cached) return successResponse(res, cached);

  const result = await populateLead(Lead.findById(leadDoc._id));
  const populated = await result;
  if (!populated) throw new AppError('Lead not found', 404);

  const [timelines, assignments, timelineEvents] = await Promise.all([
    getLeadTimelines(populated._id),
    LeadAssignment.find({ lead: populated._id }).sort({ createdAt: -1 })
      .populate('assignedTo assignedBy previousAssignee', 'name email avatar')
      .populate('department', 'name code'),
    LeadTimelineEvent.find({ lead: populated._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);

  const fullLead = {
    ...populated.toObject(),
    ...timelines,
    assignmentHistory: assignments,
    timelineEvents,
  };
  await cacheLead(req.params.id, fullLead);

  successResponse(res, fullLead);
});

export const updateLead = asyncHandler(async (req, res) => {
  const lead = await assertLeadAccess(req.user, req.params.id, Lead);

  const previousValues = {
    status: lead.status,
    priority: lead.priority,
    assignedTo: lead.assignedTo,
  };

  const { dealAmount, dealNotes, closureDate, adminRemark, creatorRemark, ...updateData } = req.body;

  if (
    adminRemark?.trim()
    && [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role)
    && (await isAdminRemarksEnabled())
  ) {
    await AdminRemark.create({
      lead: lead._id,
      content: adminRemark.trim(),
      addedBy: req.user._id,
      authorName: req.user.name,
      authorRole: req.user.role,
      department: req.user.department?._id || req.user.department,
      departmentName: req.user.department?.name,
    });
  }

  if (updateData.status === LEAD_STATUSES.CLOSED) {
    // Deal amount is optional (EdTech lead close does not require revenue)
    if (dealAmount !== undefined && dealAmount !== null && dealAmount !== '') {
      const resolvedClosureDate = closureDate ? new Date(closureDate) : new Date();
      await DealClosure.findOneAndUpdate(
        { lead: lead._id },
        {
          lead: lead._id,
          leadRef: lead.leadId,
          name: lead.name,
          amount: dealAmount,
          closureDate: resolvedClosureDate,
          closedBy: req.user._id,
          department: lead.department,
          notes: dealNotes,
          status: 'active',
          cancelledAt: undefined,
          cancelledBy: undefined,
          cancellationReason: undefined,
        },
        { upsert: true }
      );

      lead.dealClosure = {
        amount: dealAmount,
        closureDate: resolvedClosureDate,
        closedBy: req.user._id,
        notes: dealNotes,
      };

      await logActivity({
        user: req.user,
        action: ACTIVITY_ACTIONS.DEAL_CLOSE,
        entityType: ENTITY_TYPES.DEAL_CLOSURE,
        entityId: lead._id,
        updatedValues: { amount: dealAmount },
        metadata: { leadId: lead.leadId },
        ipAddress: req.clientIp,
        deviceInfo: req.deviceInfo,
      });
    }
  } else if (
    previousValues.status === LEAD_STATUSES.CLOSED
    && updateData.status
    && updateData.status !== LEAD_STATUSES.CLOSED
  ) {
    await DealClosure.findOneAndUpdate(
      { lead: lead._id },
      {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: req.user._id,
        cancellationReason: 'Deal closure removed due to status change',
      }
    );

    lead.dealClosure = undefined;

    await logActivity({
      user: req.user,
      action: ACTIVITY_ACTIONS.DEAL_CANCEL,
      entityType: ENTITY_TYPES.DEAL_CLOSURE,
      entityId: lead._id,
      metadata: { leadId: lead.leadId, reason: 'Deal closure removed due to status change' },
      ipAddress: req.clientIp,
      deviceInfo: req.deviceInfo,
    });
  }

  if (updateData.status && updateData.status !== previousValues.status) {
    await logActivity({
      user: req.user,
      action: ACTIVITY_ACTIONS.STATUS_CHANGE,
      entityType: ENTITY_TYPES.LEAD,
      entityId: lead._id,
      previousValues: { status: previousValues.status },
      updatedValues: { status: updateData.status },
      metadata: {
        leadId: lead.leadId,
        from: previousValues.status,
        to: updateData.status,
        description: `Changed status from ${previousValues.status} to ${updateData.status}`,
      },
      ipAddress: req.clientIp,
      deviceInfo: req.deviceInfo,
    });
  }

  if (updateData.course !== undefined) {
    updateData.course = normalizeCourseValue(updateData.course);
  }
  if (updateData.customFields || updateData.course !== undefined || updateData.leadDate !== undefined) {
    updateData.leadDate = resolveLeadDate({ ...lead.toObject(), ...updateData }) || lead.leadDate || lead.createdAt;
  }

  Object.assign(lead, updateData);
  lead.lastActivityAt = new Date();
  await lead.save();

  if (creatorRemark?.trim()) {
    const canRemarkAsCreator = (() => {
      if ([ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role)) {
        const creatorId = lead.createdBy?._id?.toString() || lead.createdBy?.toString();
        return creatorId === req.user._id.toString();
      }
      return true; // employees with lead access may add status remarks
    })();

    if (canRemarkAsCreator) {
      const nextStatus = updateData.status || previousValues.status;
      const statusChanged = Boolean(updateData.status && updateData.status !== previousValues.status);
      await CreatorRemark.create({
        lead: lead._id,
        content: creatorRemark.trim(),
        createdBy: req.user._id,
        authorName: req.user.name,
        authorRole: req.user.role,
        relatedStatus: nextStatus,
        previousStatus: statusChanged ? previousValues.status : undefined,
      });

      await logActivity({
        user: req.user,
        action: ACTIVITY_ACTIONS.REMARK_ADD,
        entityType: ENTITY_TYPES.REMARK,
        entityId: lead._id,
        metadata: {
          type: 'creator',
          relatedStatus: nextStatus,
          previousStatus: statusChanged ? previousValues.status : undefined,
        },
        ipAddress: req.clientIp,
        deviceInfo: req.deviceInfo,
      });
    }
  }

  await invalidateLeadCache(lead._id.toString());
  await invalidateDashboardCache('department', lead.department.toString());

  const updateKeys = Object.keys(updateData).filter((k) => updateData[k] !== undefined);
  const nonStatusKeys = updateKeys.filter((k) => k !== 'status');
  // Avoid a duplicate generic "Update" when only status changed (already logged above).
  if (nonStatusKeys.length > 0) {
    await logActivity({
      user: req.user,
      action: ACTIVITY_ACTIONS.UPDATE,
      entityType: ENTITY_TYPES.LEAD,
      entityId: lead._id,
      previousValues,
      updatedValues: req.body,
      metadata: {
        leadId: lead.leadId,
        fields: nonStatusKeys,
        description: `Updated ${nonStatusKeys.join(', ')}`,
      },
      ipAddress: req.clientIp,
      deviceInfo: req.deviceInfo,
    });
  }

  const updated = await populateLead(Lead.findById(lead._id));
  successResponse(res, await updated, 'Lead updated');
});

const assertCanDeleteLeads = (user) => {
  if (![ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(user.role)) {
    throw new AppError('Only admins can delete leads', 403, 'FORBIDDEN');
  }
};

const buildListFilterFromQuery = (req) => {
  const {
    status,
    priority,
    department,
    assignedTo,
    search,
    scope,
    dateFrom,
    dateTo,
    source,
    course,
    connectorId,
  } = req.body?.filters || req.query || {};

  const filter = { isDeleted: false };

  if (req.user.role === ROLES.EMPLOYEE && scope === 'assigned') {
    filter.assignedTo = req.user._id;
  } else if (req.user.role === ROLES.EMPLOYEE && scope === 'created') {
    filter.createdBy = req.user._id;
  } else {
    Object.assign(filter, req.leadFilter || {});
  }

  return applyLeadQueryFilters(filter, {
    status,
    priority,
    department,
    assignedTo,
    search,
    dateFrom,
    dateTo,
    source,
    course,
    connectorId,
  }, req.user);
};

export const softDeleteLead = asyncHandler(async (req, res) => {
  assertCanDeleteLeads(req.user);
  const lead = await assertLeadAccess(req.user, req.params.id, Lead);

  lead.isDeleted = true;
  lead.lastActivityAt = new Date();
  await lead.save();

  await invalidateLeadCache(lead._id.toString());
  await invalidateAllDashboardCaches();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.DELETE,
    entityType: ENTITY_TYPES.LEAD,
    entityId: lead._id,
    metadata: { soft: true, leadId: lead.leadId },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, { id: lead._id }, 'Lead deleted');
});

export const bulkSoftDeleteLeads = asyncHandler(async (req, res) => {
  assertCanDeleteLeads(req.user);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) throw new AppError('Select at least one lead to delete', 400);

  const filter = mergeLeadScope(req.user, { _id: { $in: ids }, isDeleted: false });
  const result = await Lead.updateMany(filter, {
    $set: { isDeleted: true, lastActivityAt: new Date() },
  });

  await invalidateAllDashboardCaches();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.DELETE,
    entityType: ENTITY_TYPES.LEAD,
    metadata: { soft: true, bulk: true, requested: ids.length, deleted: result.modifiedCount },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, { deleted: result.modifiedCount }, `${result.modifiedCount} lead(s) deleted`);
});

export const softDeleteAllLeads = asyncHandler(async (req, res) => {
  assertCanDeleteLeads(req.user);
  if (req.body?.confirm !== true && req.body?.confirm !== 'DELETE') {
    throw new AppError('Confirmation required to delete all matching leads', 400);
  }

  const filter = buildListFilterFromQuery(req);
  const total = await Lead.countDocuments(filter);
  if (!total) {
    return successResponse(res, { deleted: 0 }, 'No leads matched the current filters');
  }

  const result = await Lead.updateMany(filter, {
    $set: { isDeleted: true, lastActivityAt: new Date() },
  });

  await invalidateAllDashboardCaches();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.DELETE,
    entityType: ENTITY_TYPES.LEAD,
    metadata: {
      soft: true,
      deleteAll: true,
      matched: total,
      deleted: result.modifiedCount,
      filters: req.body?.filters || {},
    },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, { deleted: result.modifiedCount }, `${result.modifiedCount} lead(s) deleted`);
});

export const assignLead = asyncHandler(async (req, res) => {
  const lead = await assertLeadAccess(req.user, req.params.id, Lead);

  const isEmployee = req.user.role === ROLES.EMPLOYEE;
  if (isEmployee) {
    const isAssigned = lead.assignedTo?.toString() === req.user._id.toString();
    const isCreator = lead.createdBy?.toString() === req.user._id.toString();
    if (!isAssigned && !isCreator) {
      throw new AppError('You can only reassign leads assigned to you or created by you', 403);
    }
  }

  const assignee = await User.findById(req.body.assignedTo).populate('department');
  if (!assignee?.isActive) throw new AppError('Invalid assignee', 400);

  if (req.user.role === ROLES.ADMIN) {
    const adminDept = req.user.department?._id?.toString() || req.user.department?.toString();
    const assigneeDept = assignee.department?._id?.toString() || assignee.department?.toString();
    if (adminDept && assigneeDept && adminDept !== assigneeDept) {
      throw new AppError('Can only assign to employees in your department', 403);
    }
  }

  if (isEmployee) {
    const leadDept = lead.department?.toString();
    const assigneeDept = assignee.department?._id?.toString() || assignee.department?.toString();
    if (leadDept && assigneeDept && leadDept !== assigneeDept) {
      throw new AppError('Can only assign within your department', 403);
    }
  }

  const previousAssignee = lead.assignedTo;
  const previousAssigneeUser = previousAssignee ? await User.findById(previousAssignee).select('name') : null;

  lead.assignedTo = req.body.assignedTo;
  lead.lastActivityAt = new Date();
  await lead.save();

  const assignmentReason = req.body.reason || req.body.notes;

  await LeadAssignment.create({
    lead: lead._id,
    assignedTo: req.body.assignedTo,
    assignedBy: req.user._id,
    department: lead.department,
    previousAssignee,
    type: previousAssignee ? 'reassign' : 'assign',
    notes: req.body.notes,
    reason: assignmentReason,
  });

  if (assignee.email) {
    await addEmailJob({
      type: 'lead_assigned',
      email: assignee.email,
      name: assignee.name,
      lead: { leadId: lead.leadId, name: lead.name, priority: lead.priority, status: lead.status },
    });
  }

  await invalidateLeadCache(lead._id.toString());

  await logActivity({
    user: req.user,
    action: previousAssignee ? ACTIVITY_ACTIONS.REASSIGN : ACTIVITY_ACTIONS.ASSIGN,
    entityType: ENTITY_TYPES.LEAD,
    entityId: lead._id,
    previousValues: { assignedTo: previousAssignee },
    updatedValues: { assignedTo: req.body.assignedTo },
    metadata: {
      leadId: lead.leadId,
      previousAssigneeName: previousAssigneeUser?.name || null,
      newAssigneeName: assignee.name,
      reason: assignmentReason,
    },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, await populateLead(Lead.findById(lead._id)), 'Lead assigned');
});

export const requestTransfer = asyncHandler(async (req, res) => {
  const lead = await assertLeadAccess(req.user, req.params.id, Lead);

  if (lead.transferRequest?.status === TRANSFER_STATUSES.PENDING) {
    throw new AppError('Transfer already pending', 400);
  }

  lead.transferRequest = {
    fromDepartment: lead.department,
    toDepartment: req.body.toDepartment,
    requestedBy: req.user._id,
    reason: req.body.reason,
    status: req.user.role === ROLES.SUPER_ADMIN ? TRANSFER_STATUSES.APPROVED : TRANSFER_STATUSES.PENDING,
  };

  if (req.user.role === ROLES.SUPER_ADMIN) {
    lead.department = req.body.toDepartment;
    lead.transferRequest.reviewedBy = req.user._id;
    lead.transferRequest.reviewedAt = new Date();
  }

  await lead.save();
  await invalidateLeadCache(lead._id.toString());

  successResponse(res, lead, req.user.role === ROLES.SUPER_ADMIN ? 'Lead transferred' : 'Transfer request submitted');
});

export const importLeads = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('File required', 400);

  const departmentId = req.user.role === ROLES.ADMIN
    ? req.user.department._id || req.user.department
    : req.body.department;

  const importHistory = await ImportHistory.create({
    fileName: req.file.originalname,
    fileSize: req.file.size,
    importedBy: req.user._id,
    department: departmentId,
    status: 'pending',
  });

  await addImportJob({
    importHistoryId: importHistory._id,
    filePath: req.file.path,
    userId: req.user._id,
    departmentId,
  });

  successResponse(res, importHistory, 'Import queued for processing', 202);
});

export const getImportTemplate = asyncHandler(async (_req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Leads');
  sheet.columns = [
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Phone', key: 'phone', width: 15 },
    { header: 'Address', key: 'address', width: 30 },
    { header: 'City', key: 'city', width: 15 },
    { header: 'State', key: 'state', width: 15 },
    { header: 'Pincode', key: 'pincode', width: 10 },
    { header: 'Priority', key: 'priority', width: 10 },
  ];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=lead-import-template.xlsx');
  await workbook.xlsx.write(res);
});

export const getImportHistory = asyncHandler(async (req, res) => {
  const filter = req.user.role === ROLES.SUPER_ADMIN
    ? {}
    : { department: req.user.department._id || req.user.department };

  const history = await ImportHistory.find(filter)
    .populate('importedBy', 'name email')
    .sort({ createdAt: -1 })
    .limit(50);

  successResponse(res, history);
});

export const createWebsiteLead = asyncHandler(async (req, res) => {
  const data = req.body;
  let department = null;

  if (data.departmentCode) {
    department = await Department.findOne({ code: data.departmentCode.toUpperCase(), isActive: true });
  }
  if (!department) {
    department = await Department.findOne({ isActive: true }).sort({ createdAt: 1 });
  }
  if (!department) throw new AppError('No active department', 400);

  const externalId = data.sourceDetails?.externalId;
  if (externalId) {
    const existing = await Lead.findOne({ 'sourceDetails.externalId': externalId });
    if (existing) throw new AppError('Duplicate import', 409);
  }

  const duplicateHash = buildDuplicateHash(data.phone, data.email);
  const leadId = await generateLeadId(Lead);

  const superAdmin = await User.findOne({ role: ROLES.SUPER_ADMIN });

  const lead = await Lead.create({
    leadId,
    name: data.name,
    email: data.email,
    phone: data.phone,
    address: data.address,
    source: LEAD_SOURCES.WEBSITE,
    sourceDetails: data.sourceDetails,
    department: department._id,
    createdBy: superAdmin?._id,
    duplicateHash,
    lastActivityAt: new Date(),
  });

  successResponse(res, { leadId: lead.leadId }, 'Lead received', 201);
});

export const getFollowUpDashboard = asyncHandler(async (req, res) => {
  const { todayStart, todayEnd, tomorrowStart, tomorrowEnd } = getFollowUpDayWindows();

  const baseFilter = {
    isDeleted: false,
    nextFollowUpDate: { $exists: true, $ne: null },
    status: { $nin: CLOSED_STATUSES },
    ...req.leadFilter,
  };

  const sortByPriorityAndTime = (items) =>
    items.sort((a, b) => {
      const priorityDiff = (PRIORITY_ORDER[a.priority] || 99) - (PRIORITY_ORDER[b.priority] || 99);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.nextFollowUpDate) - new Date(b.nextFollowUpDate);
    });

  const [today, tomorrow, overdue] = await Promise.all([
    populateLead(Lead.find({ ...baseFilter, nextFollowUpDate: { $gte: todayStart, $lte: todayEnd } })),
    populateLead(Lead.find({ ...baseFilter, nextFollowUpDate: { $gte: tomorrowStart, $lte: tomorrowEnd } })),
    populateLead(Lead.find({
      ...baseFilter,
      nextFollowUpDate: { $lt: todayStart },
    })),
  ]);

  successResponse(res, {
    today: sortByPriorityAndTime(await today),
    tomorrow: sortByPriorityAndTime(await tomorrow),
    overdue: sortByPriorityAndTime(await overdue),
  });
});

export const trackCommunication = asyncHandler(async (req, res) => {
  const lead = await assertLeadAccess(req.user, req.params.id, Lead);
  const { type } = req.body;

  if (!['call', 'email'].includes(type)) {
    throw new AppError('Invalid communication type', 400);
  }

  const action = type === 'call' ? ACTIVITY_ACTIONS.CALL_INITIATED : ACTIVITY_ACTIONS.EMAIL_INITIATED;
  const description = type === 'call'
    ? 'Customer call initiated.'
    : 'Customer email initiated.';

  lead.lastActivityAt = new Date();
  await lead.save();
  await invalidateLeadCache(lead._id.toString());

  const log = await logActivity({
    user: req.user,
    action,
    entityType: ENTITY_TYPES.LEAD,
    entityId: lead._id,
    metadata: { leadId: lead.leadId, type, description },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, log, 'Communication tracked', 201);
});

export const scheduleLeadFollowUp = asyncHandler(async (req, res) => {
  const lead = await assertLeadAccess(req.user, req.params.id, Lead);
  const scheduledDate = new Date(req.body.scheduledDate);

  if (scheduledDate <= new Date()) {
    throw new AppError('Follow-up date must be in the future', 400);
  }

  const followUp = await FollowUp.create({
    lead: lead._id,
    scheduledBy: req.user._id,
    assignedTo: lead.assignedTo || req.user._id,
    department: lead.department,
    scheduledDate,
    notes: req.body.notes,
  });

  lead.nextFollowUpDate = scheduledDate;
  if (lead.status === LEAD_STATUSES.NEW) {
    lead.status = LEAD_STATUSES.FOLLOW_UP;
  }
  lead.lastActivityAt = new Date();
  await lead.save();
  await invalidateLeadCache(lead._id.toString());
  await invalidateAllDashboardCaches();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.FOLLOW_UP_CREATE,
    entityType: ENTITY_TYPES.FOLLOW_UP,
    entityId: followUp._id,
    metadata: { leadId: lead.leadId, scheduledDate },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  const populated = await FollowUp.findById(followUp._id)
    .populate('lead', 'leadId name phone priority status nextFollowUpDate')
    .populate('assignedTo scheduledBy', 'name email');

  successResponse(res, populated, 'Follow-up scheduled', 201);
});
