import { AppError } from './apiResponse.js';

export const SORT_FIELDS = new Set([
  'createdAt', 'updatedAt', 'leadDate', 'leadId', 'name', 'email', 'phone',
  'status', 'priority', 'course', 'source', 'nextFollowUpDate', 'lastActivityAt',
  'scheduledDate', 'role', 'department', 'assignedTo', 'isActive', 'completedAt',
]);

export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const csvCell = (value) => {
  let text = String(value ?? '');
  // eslint-disable-next-line no-control-regex -- Reject control characters in exported or imported text.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export const assertSafeQuery = (query = {}) => {
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('$') || key.includes('.') || typeof value !== 'string' || value.length > 2000) {
      throw new AppError('Query parameters must be bounded scalar values', 400, 'INVALID_QUERY');
    }
  }
  for (const [key, max] of [['page', 100000], ['limit', 500]]) {
    if (query[key] !== undefined && (!/^[1-9]\d*$/.test(query[key]) || Number(query[key]) > max)) {
      throw new AppError(`Invalid ${key}`, 400, 'INVALID_QUERY');
    }
  }
  if (query.sortBy && !SORT_FIELDS.has(query.sortBy)) throw new AppError('Invalid sort field', 400, 'INVALID_QUERY');
  if (query.sortOrder && !['asc', 'desc'].includes(query.sortOrder)) throw new AppError('Invalid sort order', 400, 'INVALID_QUERY');
  for (const key of ['dateFrom', 'dateTo']) {
    if (query[key] && Number.isNaN(Date.parse(query[key]))) throw new AppError('Invalid date filter', 400, 'INVALID_QUERY');
  }
  if (query.dateFrom && query.dateTo && Date.parse(query.dateFrom) > Date.parse(query.dateTo)) {
    throw new AppError('Date range is reversed', 400, 'INVALID_QUERY');
  }
};

export const redactAuditValues = (value) => {
  if (Array.isArray(value)) return value.map(redactAuditValues);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  // Leave BSON IDs intact.
  if (value._bsontype) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, /password|token|secret|otp|privatekey/i.test(key) ? '[REDACTED]' : redactAuditValues(item),
  ]));
};
