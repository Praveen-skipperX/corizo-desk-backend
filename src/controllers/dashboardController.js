import { asyncHandler, successResponse, paginatedResponse } from '../utils/apiResponse.js';
import { buildPagination, parseSort } from '../utils/helpers.js';
import {
  Lead,
  ActivityLog,
  User,
} from '../models/index.js';
import { ROLES, LEAD_STATUSES, ACTIVITY_ACTIONS } from '../constants/index.js';
import {
  getCachedDashboardStats,
  cacheDashboardStats,
} from '../services/redisService.js';
import { buildLeadScopeFilter } from '../utils/leadAccess.js';
import { normalizeCourseValue } from '../utils/customFields.js';

const OPEN_STATUSES = [
  LEAD_STATUSES.NEW,
  LEAD_STATUSES.ASSIGNED,
  LEAD_STATUSES.ATTEMPTED,
  LEAD_STATUSES.CONNECTED,
  LEAD_STATUSES.INTERESTED,
  LEAD_STATUSES.FOLLOW_UP,
];

const CLOSED_STATUSES = [
  LEAD_STATUSES.CLOSED,
  LEAD_STATUSES.NOT_INTERESTED,
  LEAD_STATUSES.DUPLICATE,
  LEAD_STATUSES.SPAM,
];

/** Sheet date (leadDate) when present, otherwise createdAt — for dashboard date stats. */
const STATS_DATE_EXPR = { $ifNull: ['$leadDate', '$createdAt'] };

const mergeCourseCounts = (rows = []) => {
  const merged = new Map();
  for (const row of rows) {
    const label = normalizeCourseValue(row._id) || row._id || 'Unknown';
    merged.set(label, (merged.get(label) || 0) + row.count);
  }
  return [...merged.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
};

const formatActivityDescription = (activity) => {
  const name = activity.userName || activity.user?.name || 'Someone';
  const meta = activity.metadata || {};
  const leadRef = meta.leadId ? `Lead ${meta.leadId}` : 'lead';

  switch (activity.action) {
    case ACTIVITY_ACTIONS.ASSIGN:
      return meta.newAssigneeName
        ? `${name} assigned ${leadRef} to ${meta.newAssigneeName}`
        : `${name} assigned ${leadRef}`;
    case ACTIVITY_ACTIONS.REASSIGN:
      return meta.newAssigneeName
        ? `${name} reassigned ${leadRef} to ${meta.newAssigneeName}`
        : `${name} reassigned ${leadRef}`;
    case ACTIVITY_ACTIONS.CREATE:
      if (activity.entityType === 'lead') return `${name} created ${leadRef}`;
      return `${name} created ${activity.entityType?.replace(/_/g, ' ')}`;
    case ACTIVITY_ACTIONS.STATUS_CHANGE: {
      const from = activity.previousValues?.status || meta.from;
      const to = activity.updatedValues?.status || meta.to;
      if (from && to) {
        return `${name} changed status ${String(from).replace(/_/g, ' ')} → ${String(to).replace(/_/g, ' ')}`;
      }
      return meta.description || `${name} changed lead status`;
    }
    case ACTIVITY_ACTIONS.UPDATE: {
      const fields = Array.isArray(meta.fields) ? meta.fields.filter((f) => f !== 'status') : [];
      if (fields.length) {
        return `${name} updated ${fields.join(', ')}`;
      }
      return meta.description || `${name} updated ${activity.entityType?.replace(/_/g, ' ')}`;
    }
    case ACTIVITY_ACTIONS.LOGIN:
      return `${name} logged in`;
    case ACTIVITY_ACTIONS.LOGOUT:
      return `${name} logged out`;
    case ACTIVITY_ACTIONS.USER_CREATE:
      return `${name} created a user account`;
    case ACTIVITY_ACTIONS.FOLLOW_UP_CREATE:
      return `${name} scheduled a follow-up`;
    case ACTIVITY_ACTIONS.FOLLOW_UP_COMPLETE:
      return `${name} completed a follow-up`;
    case ACTIVITY_ACTIONS.DEAL_CLOSE:
      return `${name} closed a deal`;
    case ACTIVITY_ACTIONS.DEAL_CANCEL:
      return meta.reason || `${name} removed deal closure`;
    case ACTIVITY_ACTIONS.CALL_INITIATED:
      return meta.description || `${name} initiated a phone call`;
    case ACTIVITY_ACTIONS.EMAIL_INITIATED:
      return meta.description || `${name} initiated an email`;
    default:
      return `${name} ${activity.action?.replace(/_/g, ' ')} ${activity.entityType?.replace(/_/g, ' ')}`;
  }
};

export const getDashboard = asyncHandler(async (req, res) => {
  const scope = req.user.role === ROLES.SUPER_ADMIN ? 'global' : req.user.role === ROLES.ADMIN ? 'department' : 'employee';
  const scopeId = scope === 'global' ? 'all' : scope === 'department' ? (req.user.department._id || req.user.department).toString() : req.user._id.toString();

  const cached = await getCachedDashboardStats(scope, scopeId);
  if (cached) return successResponse(res, cached);

  const leadFilter = { isDeleted: false, ...buildLeadScopeFilter(req.user) };
  let activityFilter = {};

  if (req.user.role === ROLES.ADMIN) {
    const deptId = req.user.department._id || req.user.department;
    activityFilter.department = deptId;
  } else if (req.user.role === ROLES.EMPLOYEE) {
    activityFilter.user = req.user._id;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);

  const trendStart = new Date(todayStart);
  trendStart.setDate(trendStart.getDate() - 13);

  const closedStatusFilter = { $nin: CLOSED_STATUSES };

  const statsDateInRange = (from, to) => ({
    $expr: {
      $and: [
        { $gte: [STATS_DATE_EXPR, from] },
        { $lte: [STATS_DATE_EXPR, to] },
      ],
    },
  });

  const [
    totalLeads,
    openLeads,
    closedWon,
    closedLost,
    statusDistribution,
    priorityDistribution,
    departmentDistribution,
    todayFollowUps,
    overdueFollowUps,
    lockedAccounts,
    recentActivitiesRaw,
    todaysLeads,
    weekLeads,
    weekEnrollments,
    sourceDistribution,
    courseInterest,
    courseEnrollments,
    leadsByDayRaw,
    enrollmentsByDayRaw,
  ] = await Promise.all([
    Lead.countDocuments(leadFilter),
    Lead.countDocuments({ ...leadFilter, status: { $in: OPEN_STATUSES } }),
    Lead.countDocuments({ ...leadFilter, status: LEAD_STATUSES.CLOSED }),
    Lead.countDocuments({ ...leadFilter, status: LEAD_STATUSES.NOT_INTERESTED }),
    Lead.aggregate([
      { $match: leadFilter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Lead.aggregate([
      { $match: leadFilter },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
    ]),
    req.user.role === ROLES.SUPER_ADMIN
      ? Lead.aggregate([
          { $match: { isDeleted: false } },
          { $group: { _id: '$department', count: { $sum: 1 } } },
          { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
          { $unwind: '$dept' },
          { $project: { name: '$dept.name', count: 1 } },
        ])
      : Promise.resolve([]),
    Lead.countDocuments({
      ...leadFilter,
      nextFollowUpDate: { $gte: todayStart, $lte: todayEnd },
      status: closedStatusFilter,
    }),
    Lead.countDocuments({
      ...leadFilter,
      nextFollowUpDate: { $lt: todayStart, $exists: true, $ne: null },
      status: closedStatusFilter,
    }),
    req.user.role === ROLES.SUPER_ADMIN ? User.countDocuments({ isLocked: true }) : Promise.resolve(0),
    ActivityLog.find(activityFilter)
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user', 'name email')
      .populate('department', 'name'),
    // Date cards / trends use sheet leadDate (fallback createdAt)
    Lead.countDocuments({ ...leadFilter, ...statsDateInRange(todayStart, todayEnd) }),
    Lead.countDocuments({ ...leadFilter, ...statsDateInRange(weekStart, todayEnd) }),
    Lead.countDocuments({
      ...leadFilter,
      status: LEAD_STATUSES.CLOSED,
      ...statsDateInRange(weekStart, todayEnd),
    }),
    Lead.aggregate([
      { $match: leadFilter },
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Lead.aggregate([
      { $match: { ...leadFilter, course: { $exists: true, $nin: [null, ''] } } },
      { $group: { _id: '$course', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Lead.aggregate([
      {
        $match: {
          ...leadFilter,
          status: LEAD_STATUSES.CLOSED,
          course: { $exists: true, $nin: [null, ''] },
        },
      },
      { $group: { _id: '$course', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Lead.aggregate([
      { $match: { ...leadFilter, ...statsDateInRange(trendStart, todayEnd) } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: STATS_DATE_EXPR,
              timezone: 'Asia/Kolkata',
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Lead.aggregate([
      {
        $match: {
          ...leadFilter,
          status: LEAD_STATUSES.CLOSED,
          ...statsDateInRange(trendStart, todayEnd),
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: STATS_DATE_EXPR,
              timezone: 'Asia/Kolkata',
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const closedLeads = closedWon + closedLost;
  const conversionRate = totalLeads > 0
    ? ((closedWon / totalLeads) * 100).toFixed(1)
    : 0;

  const leadsByDayMap = new Map(leadsByDayRaw.map((r) => [r._id, r.count]));
  const enrollmentsByDayMap = new Map(enrollmentsByDayRaw.map((r) => [r._id, r.count]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const leadsTrend = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(todayStart);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    leadsTrend.push({
      date: key,
      name: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      leads: leadsByDayMap.get(key) || 0,
      enrollments: enrollmentsByDayMap.get(key) || 0,
    });
  }

  const recentActivities = recentActivitiesRaw.map((a) => ({
    ...(a.toObject ? a.toObject() : a),
    description: formatActivityDescription(a),
  }));

  const dashboard = {
    summary: {
      totalLeads,
      todaysLeads,
      weekLeads,
      weekEnrollments,
      openLeads,
      closedLeads,
      closedWon,
      closedLost,
      notInterested: closedLost,
      pendingFollowUps: todayFollowUps + overdueFollowUps,
      conversionRate: parseFloat(conversionRate),
      todayFollowUps,
      overdueFollowUps,
      lockedAccounts,
    },
    charts: {
      statusDistribution: statusDistribution.map((s) => ({ name: s._id, value: s.count })),
      priorityDistribution: priorityDistribution.map((p) => ({ name: p._id || 'unset', value: p.count })),
      sourceDistribution: sourceDistribution.map((s) => ({ name: s._id || 'unknown', value: s.count })),
      courseDistribution: mergeCourseCounts(courseInterest),
      courseEnrollments: mergeCourseCounts(courseEnrollments),
      leadsTrend,
      departmentDistribution,
    },
    recentActivities,
  };

  await cacheDashboardStats(scope, scopeId, dashboard);
  successResponse(res, dashboard);
});

export const getActivityLogs = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 25,
    action,
    entityType,
    userId,
    userRole,
    department,
    dateFrom,
    dateTo,
    search,
    leadId,
    assignmentChanges,
    statusChanges,
    sortBy,
    sortOrder,
  } = req.query;

  const filter = { ...req.activityFilter };

  if (action) filter.action = action;
  if (entityType) filter.entityType = entityType;
  if (userId) filter.user = userId;
  if (userRole) filter.userRole = userRole;
  if (department && req.user.role === ROLES.SUPER_ADMIN) filter.department = department;
  if (leadId) filter['metadata.leadId'] = leadId;

  if (assignmentChanges === 'true') {
    filter.action = { $in: [ACTIVITY_ACTIONS.ASSIGN, ACTIVITY_ACTIONS.REASSIGN] };
  }
  if (statusChanges === 'true') {
    filter.action = ACTIVITY_ACTIONS.STATUS_CHANGE;
  }

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  if (search) {
    filter.$or = [
      { userName: { $regex: search, $options: 'i' } },
      { 'metadata.leadId': { $regex: search, $options: 'i' } },
      { entityId: { $regex: search, $options: 'i' } },
    ];
  }

  const pageLimit = Math.min(Number(limit) || 25, 100);
  const skip = (page - 1) * pageLimit;

  const [logs, total] = await Promise.all([
    ActivityLog.find(filter)
      .populate('user', 'name email role')
      .populate('department', 'name code')
      .sort(parseSort(sortBy || 'createdAt', sortOrder || 'desc'))
      .skip(skip)
      .limit(pageLimit),
    ActivityLog.countDocuments(filter),
  ]);

  const enriched = logs.map((log) => ({
    ...(log.toObject ? log.toObject() : log),
    description: formatActivityDescription(log),
  }));

  paginatedResponse(res, enriched, buildPagination(page, pageLimit, total));
});

export const globalSearch = asyncHandler(async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return successResponse(res, { leads: [], users: [] });
  }

  const leadFilter = { isDeleted: false, $text: { $search: q }, ...req.leadFilter };

  const [leads, users] = await Promise.all([
    Lead.find(leadFilter)
      .select('leadId name email phone status priority')
      .limit(10),
    req.user.role !== ROLES.EMPLOYEE
      ? User.find({
          $or: [
            { name: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } },
          ],
          isActive: true,
          role: { $ne: ROLES.SUPER_ADMIN },
          ...(req.user.role === ROLES.ADMIN ? { department: req.user.department._id || req.user.department } : {}),
        })
          .select('name email role')
          .limit(5)
      : Promise.resolve([]),
  ]);

  successResponse(res, { leads, users });
});
