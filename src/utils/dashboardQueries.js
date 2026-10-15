import { LEAD_STATUSES } from '../constants/index.js';

const OPEN = ['new', 'assigned', 'attempted', 'connected', 'interested', 'follow_up'];
const CLOSED = ['closed', 'not_interested', 'duplicate', 'spam'];
const date = { $ifNull: ['$leadDate', '$createdAt'] };

export const buildDashboardQueries = (filter, { todayStart, todayEnd, weekStart, trendStart }, includeDepartments) => {
  const inRange = (from) => ({ $expr: { $and: [{ $gte: [date, from] }, { $lte: [date, todayEnd] }] } });
  const group = (field) => [{ $match: filter }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }];
  return {
    statusDistribution: group('status'), priorityDistribution: group('priority'),
    sourceDistribution: [...group('source'), { $sort: { count: -1 } }],
    courseCounts: [
      { $match: { ...filter, course: { $exists: true, $nin: [null, ''] } } },
      { $group: { _id: '$course', count: { $sum: 1 }, enrolled: { $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.CLOSED] }, 1, 0] } } } },
      { $sort: { count: -1 } },
    ],
    followUpCounts: [
      { $match: { ...filter, status: { $nin: CLOSED }, nextFollowUpDate: { $exists: true, $ne: null, $lte: todayEnd } } },
      { $group: { _id: { $cond: [{ $lt: ['$nextFollowUpDate', todayStart] }, 'overdue', 'today'] }, count: { $sum: 1 } } },
    ],
    dateCounts: [
      { $match: { ...filter, ...inRange(weekStart) } },
      { $group: { _id: null, weekLeads: { $sum: 1 },
        todaysLeads: { $sum: { $cond: [{ $gte: [date, todayStart] }, 1, 0] } },
        weekEnrollments: { $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.CLOSED] }, 1, 0] } },
      } },
    ],
    trendCounts: [
      { $match: { ...filter, ...inRange(trendStart) } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date, timezone: 'Asia/Kolkata' } }, count: { $sum: 1 },
        enrolled: { $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.CLOSED] }, 1, 0] } },
      } }, { $sort: { _id: 1 } },
    ],
    ...(includeDepartments ? { departmentDistribution: [
      ...group('department'),
      { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'dept' } },
      { $unwind: '$dept' }, { $project: { name: '$dept.name', count: 1 } },
    ] } : {}),
  };
};

export const queryDashboard = async (Lead, filter, windows, includeDepartments) => {
  const queries = Object.entries(buildDashboardQueries(filter, windows, includeDepartments));
  const results = await Promise.all(queries.map(async ([key, pipeline]) => [
    key, await Lead.aggregate(pipeline).option({ maxTimeMS: 15000 }),
  ]));
  const facets = Object.fromEntries(results);
  const statuses = new Map(facets.statusDistribution.map((row) => [row._id, row.count]));
  const due = new Map(facets.followUpCounts.map((row) => [row._id, row.count]));
  facets.summary = [{
    totalLeads: facets.statusDistribution.reduce((sum, row) => sum + row.count, 0),
    openLeads: OPEN.reduce((sum, status) => sum + (statuses.get(status) || 0), 0),
    closedWon: statuses.get(LEAD_STATUSES.CLOSED) || 0,
    closedLost: statuses.get(LEAD_STATUSES.NOT_INTERESTED) || 0,
    todayFollowUps: due.get('today') || 0, overdueFollowUps: due.get('overdue') || 0,
    ...(facets.dateCounts[0] || {}),
  }];
  facets.courseInterest = facets.courseCounts;
  facets.courseEnrollments = facets.courseCounts.filter((row) => row.enrolled > 0).map((row) => ({ _id: row._id, count: row.enrolled }));
  facets.leadsByDayRaw = facets.trendCounts;
  facets.enrollmentsByDayRaw = facets.trendCounts.map((row) => ({ _id: row._id, count: row.enrolled }));
  return facets;
};
