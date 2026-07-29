/** App business timezone for “today / tomorrow” follow-up and dashboard day buckets. */
export const APP_TIMEZONE = 'Asia/Kolkata';

/**
 * Calendar day string (YYYY-MM-DD) in the given IANA timezone.
 */
export const formatZonedDay = (date = new Date(), timeZone = APP_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

/**
 * Start/end of a calendar day in APP_TIMEZONE as UTC Date objects for Mongo range queries.
 */
export const getZonedDayBounds = (dayStr, timeZone = APP_TIMEZONE) => {
  // Fixed offset for IST; APP_TIMEZONE is Asia/Kolkata (no DST).
  const offset = timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta' ? '+05:30' : '+05:30';
  const todayStart = new Date(`${dayStr}T00:00:00.000${offset}`);
  const todayEnd = new Date(`${dayStr}T23:59:59.999${offset}`);
  return { todayStart, todayEnd };
};

/**
 * Today / tomorrow / overdue window aligned to Asia/Kolkata (matches product UI).
 */
export const getFollowUpDayWindows = (now = new Date(), timeZone = APP_TIMEZONE) => {
  const todayStr = formatZonedDay(now, timeZone);
  const { todayStart, todayEnd } = getZonedDayBounds(todayStr, timeZone);

  const tomorrowAnchor = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = formatZonedDay(tomorrowAnchor, timeZone);
  const { todayStart: tomorrowStart, todayEnd: tomorrowEnd } = getZonedDayBounds(tomorrowStr, timeZone);

  return {
    todayStart,
    todayEnd,
    tomorrowStart,
    tomorrowEnd,
    todayStr,
    tomorrowStr,
  };
};
