import { buildDashboardQueries } from '../src/utils/dashboardQueries.js';
import { formatZonedDay, getFollowUpDayWindows } from '../src/utils/dateUtils.js';

test('dashboard preserves IST midnight and lead-date fallback', () => {
  const windows = getFollowUpDayWindows(new Date('2026-10-14T18:45:00Z'));
  expect(windows.todayStart.toISOString()).toBe('2026-10-14T18:30:00.000Z');
  expect(formatZonedDay(windows.todayStart)).toBe('2026-10-15');
  const queries = buildDashboardQueries({ isDeleted: false, department: 'dept' }, { ...windows, weekStart: windows.todayStart, trendStart: windows.todayStart }, false);
  for (const pipeline of Object.values(queries)) expect(pipeline[0].$match).toMatchObject({ isDeleted: false, department: 'dept' });
  expect(queries.trendCounts[1].$group._id.$dateToString.timezone).toBe('Asia/Kolkata');
  expect(queries.trendCounts[1].$group._id.$dateToString.date).toEqual({ $ifNull: ['$leadDate', '$createdAt'] });
  expect(queries.dateCounts[1].$group.weekEnrollments.$sum.$cond[0]).toEqual({ $eq: ['$status', 'closed'] });
});
