import { AppError, asyncHandler, successResponse, paginatedResponse } from '../utils/apiResponse.js';
import { buildPagination, parseSort } from '../utils/helpers.js';
import { FollowUp, Lead } from '../models/index.js';
import { ROLES, FOLLOW_UP_STATUSES, ACTIVITY_ACTIONS, ENTITY_TYPES, LEAD_STATUSES, PRIORITY_ORDER } from '../constants/index.js';
import { logActivity } from '../services/auditService.js';
import { invalidateLeadCache, invalidateAllDashboardCaches } from '../services/redisService.js';
import { assertLeadAccess, getAccessibleLeadIds } from '../utils/leadAccess.js';
import { getFollowUpDayWindows } from '../utils/dateUtils.js';

const buildFollowUpFilter = async (user, baseFilter = {}) => {
  if (user.role === ROLES.SUPER_ADMIN) {
    return { ...baseFilter };
  }

  if (user.role === ROLES.ADMIN) {
    return {
      ...baseFilter,
      department: user.department._id || user.department,
    };
  }

  if (user.role === ROLES.EMPLOYEE) {
    const leadIds = await getAccessibleLeadIds(user, Lead);
    return {
      ...baseFilter,
      lead: { $in: leadIds },
    };
  }

  return { ...baseFilter, _id: null };
};

export const createFollowUp = asyncHandler(async (req, res) => {
  const lead = await assertLeadAccess(req.user, req.body.lead, Lead);

  const followUp = await FollowUp.create({
    lead: lead._id,
    scheduledBy: req.user._id,
    assignedTo: req.body.assignedTo || lead.assignedTo || req.user._id,
    department: lead.department,
    scheduledDate: new Date(req.body.scheduledDate),
    notes: req.body.notes,
  });

  lead.nextFollowUpDate = new Date(req.body.scheduledDate);
  lead.status = lead.status === LEAD_STATUSES.NEW ? LEAD_STATUSES.FOLLOW_UP : lead.status;
  lead.lastActivityAt = new Date();
  await lead.save();
  await invalidateLeadCache(lead._id.toString());
  await invalidateAllDashboardCaches();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.FOLLOW_UP_CREATE,
    entityType: ENTITY_TYPES.FOLLOW_UP,
    entityId: followUp._id,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  const populated = await FollowUp.findById(followUp._id)
    .populate('lead', 'leadId name phone priority status')
    .populate('assignedTo scheduledBy', 'name email');

  successResponse(res, populated, 'Follow-up scheduled', 201);
});

export const getFollowUps = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, dateFrom, dateTo, sortBy, sortOrder } = req.query;
  const baseFilter = {};

  if (status) baseFilter.status = status;
  if (dateFrom || dateTo) {
    baseFilter.scheduledDate = {};
    if (dateFrom) baseFilter.scheduledDate.$gte = new Date(dateFrom);
    if (dateTo) baseFilter.scheduledDate.$lte = new Date(dateTo);
  }

  const filter = await buildFollowUpFilter(req.user, baseFilter);
  const skip = (page - 1) * limit;

  const [followUps, total] = await Promise.all([
    FollowUp.find(filter)
      .populate('lead', 'leadId name phone priority status')
      .populate('assignedTo scheduledBy', 'name email')
      .sort(parseSort(sortBy || 'scheduledDate', sortOrder || 'asc'))
      .skip(skip)
      .limit(Number(limit)),
    FollowUp.countDocuments(filter),
  ]);

  paginatedResponse(res, followUps, buildPagination(page, limit, total));
});

export const completeFollowUp = asyncHandler(async (req, res) => {
  const followUp = await FollowUp.findById(req.params.id).populate('lead');
  if (!followUp) throw new AppError('Follow-up not found', 404);

  if (followUp.lead) {
    await assertLeadAccess(req.user, followUp.lead._id.toString(), Lead);
  } else {
    throw new AppError('Access denied', 403);
  }

  followUp.status = FOLLOW_UP_STATUSES.COMPLETED;
  followUp.completedAt = new Date();
  followUp.completedBy = req.user._id;
  followUp.completionNotes = req.body.notes;
  await followUp.save();

  if (followUp.lead) {
    followUp.lead.lastActivityAt = new Date();
    await followUp.lead.save();
    await invalidateLeadCache(followUp.lead._id.toString());
  }
  await invalidateAllDashboardCaches();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.FOLLOW_UP_COMPLETE,
    entityType: ENTITY_TYPES.FOLLOW_UP,
    entityId: followUp._id,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, followUp, 'Follow-up completed');
});

/** Capture discussion notes once the scheduled datetime has been reached. */
export const addFollowUpDiscussion = asyncHandler(async (req, res) => {
  const followUp = await FollowUp.findById(req.params.id).populate('lead');
  if (!followUp) throw new AppError('Follow-up not found', 404);

  if (followUp.lead) {
    await assertLeadAccess(req.user, followUp.lead._id.toString(), Lead);
  } else {
    throw new AppError('Access denied', 403);
  }

  if (new Date(followUp.scheduledDate) > new Date()) {
    throw new AppError('Discussion can be added only after the scheduled date and time', 400);
  }

  const notes = req.body.notes?.trim();
  if (!notes) throw new AppError('Discussion notes are required', 400);

  followUp.discussionNotes = notes;
  followUp.discussedAt = new Date();
  followUp.discussedBy = req.user._id;
  followUp.completionNotes = notes;
  followUp.status = FOLLOW_UP_STATUSES.COMPLETED;
  followUp.completedAt = followUp.completedAt || new Date();
  followUp.completedBy = followUp.completedBy || req.user._id;
  await followUp.save();

  if (followUp.lead) {
    followUp.lead.lastActivityAt = new Date();
    // Clear next follow-up on lead if it matches this one
    const leadNext = followUp.lead.nextFollowUpDate
      ? new Date(followUp.lead.nextFollowUpDate).getTime()
      : null;
    if (leadNext && Math.abs(leadNext - new Date(followUp.scheduledDate).getTime()) < 1000) {
      followUp.lead.nextFollowUpDate = null;
    }
    await followUp.lead.save();
    await invalidateLeadCache(followUp.lead._id.toString());
  }
  await invalidateAllDashboardCaches();

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.FOLLOW_UP_COMPLETE,
    entityType: ENTITY_TYPES.FOLLOW_UP,
    entityId: followUp._id,
    metadata: { discussion: true },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  const populated = await FollowUp.findById(followUp._id)
    .populate('assignedTo scheduledBy completedBy discussedBy', 'name email');
  successResponse(res, populated, 'Discussion saved');
});

export const getFollowUpSummary = asyncHandler(async (req, res) => {
  const { todayStart, todayEnd } = getFollowUpDayWindows();

  const filter = await buildFollowUpFilter(req.user, {
    status: { $in: [FOLLOW_UP_STATUSES.SCHEDULED, FOLLOW_UP_STATUSES.OVERDUE] },
    scheduledDate: { $lte: todayEnd },
  });

  const followUps = await FollowUp.find(filter)
    .populate({
      path: 'lead',
      select: 'leadId name phone priority status assignedTo createdBy',
      populate: { path: 'assignedTo', select: 'name email' },
    })
    .sort({ scheduledDate: 1 });

  const sorted = followUps.sort((a, b) => {
    const priorityDiff = (PRIORITY_ORDER[a.lead?.priority] || 99) - (PRIORITY_ORDER[b.lead?.priority] || 99);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(a.scheduledDate) - new Date(b.scheduledDate);
  });

  const today = sorted.filter((f) => new Date(f.scheduledDate) >= todayStart && new Date(f.scheduledDate) <= todayEnd);
  const overdue = sorted.filter((f) => new Date(f.scheduledDate) < todayStart);

  successResponse(res, { today, overdue, total: sorted.length });
});
