/** Business timezone for “today / tomorrow” lead & follow-up day buckets. */
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
  }).formatToParts(date instanceof Date ? date : new Date(date));

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

/**
 * UTC Date bounds for a calendar day in APP_TIMEZONE (default Asia/Kolkata).
 * Avoids server-local setHours() which is wrong on Vercel (UTC).
 */
export const getZonedDayBounds = (dayStr, timeZone = APP_TIMEZONE) => {
  const offset = timeZone === 'Asia/Kolkata' || timeZone === 'Asia/Calcutta' ? '+05:30' : null;
  if (!offset) {
    throw new Error(`Unsupported timezone for day bounds: ${timeZone}`);
  }
  const start = new Date(`${dayStr}T00:00:00${offset}`);
  const end = new Date(`${dayStr}T23:59:59.999${offset}`);
  return { start, end };
};

/**
 * Today / tomorrow ranges in APP_TIMEZONE for follow-up dashboard queries.
 */
export const getFollowUpDayRanges = (now = new Date(), timeZone = APP_TIMEZONE) => {
  const todayStr = formatZonedDay(now, timeZone);
  const { start: todayStart, end: todayEnd } = getZonedDayBounds(todayStr, timeZone);

  const tomorrowMs = todayStart.getTime() + 24 * 60 * 60 * 1000;
  const tomorrowStr = formatZonedDay(new Date(tomorrowMs + 12 * 60 * 60 * 1000), timeZone);
  const { start: tomorrowStart, end: tomorrowEnd } = getZonedDayBounds(tomorrowStr, timeZone);

  return {
    todayStart,
    todayEnd,
    tomorrowStart,
    tomorrowEnd,
    todayStr,
    tomorrowStr,
  };
};
