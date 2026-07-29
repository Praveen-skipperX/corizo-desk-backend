import { parseSheetDate, isLeadDateField, resolveLeadDate } from './leadDate.js';

export const SYSTEM_LEAD_FIELD_KEYS = new Set([
  'name',
  'phone',
  'email',
  'course',
  'source',
  'priority',
  'status',
  'address',
  'department',
  'assignedTo',
  'createdBy',
  'leadId',
  'customFields',
  'importMeta',
  'sourceDetails',
  'duplicateHash',
  'isDeleted',
  'nextFollowUpDate',
  'lastActivityAt',
  'dealClosure',
  'transferRequest',
  '_rowKey',
  '_id',
  '__v',
]);

export const CUSTOM_FIELD_LIMITS = {
  maxFields: 50,
  maxKeyLength: 64,
  maxLabelLength: 100,
  maxValueLength: 2000,
};

/**
 * If course is a program URL/path, keep only the last segment as a readable name.
 * e.g. https://corizo.in/explore-programs/corporate-law/ → "Corporate Law"
 */
export function normalizeCourseValue(course) {
  if (course == null) return course;
  const raw = String(course).trim();
  if (!raw) return '';

  let slug = null;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const parts = new URL(raw).pathname.split('/').filter(Boolean);
      slug = parts[parts.length - 1] || null;
    } else if (raw.includes('/') && !/\s/.test(raw)) {
      const parts = raw.split('/').filter(Boolean);
      slug = parts[parts.length - 1] || null;
    }
  } catch {
    slug = null;
  }

  if (!slug) return raw;

  return slug
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const escapeRegexLocal = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Catalog name → URL slug (Corporate Law → corporate-law). */
export function courseToSlug(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Match a Course catalog name against lead.course whether stored as
 * "Corporate Law", "corporate-law", or a full explore-programs URL.
 */
export function buildCourseMatchFilter(courseFilter) {
  const raw = String(courseFilter || '').trim();
  if (!raw) return null;

  const label = normalizeCourseValue(raw) || raw;
  const slug = courseToSlug(label);
  const slugUnderscore = slug.replace(/-/g, '_');
  const patterns = [];

  const add = (pattern) => {
    if (pattern && !patterns.includes(pattern)) patterns.push(pattern);
  };

  add(`^${escapeRegexLocal(label)}$`);
  if (raw.toLowerCase() !== label.toLowerCase()) {
    add(`^${escapeRegexLocal(raw)}$`);
  }

  if (slug) {
    // Path segment in URL: .../corporate-law/ or .../corporate-law
    add(`(^|[/])${escapeRegexLocal(slug)}([/.?#]|$)`);
    if (slugUnderscore !== slug) {
      add(`(^|[/])${escapeRegexLocal(slugUnderscore)}([/.?#]|$)`);
    }
    add(`^${escapeRegexLocal(slug)}$`);
    add(`^${escapeRegexLocal(slugUnderscore)}$`);
  }

  return {
    $or: patterns.map((p) => ({ course: { $regex: p, $options: 'i' } })),
  };
}

/** True when a stored lead.course value belongs to a catalog course name. */
export function leadCourseMatchesCatalog(leadCourse, catalogName) {
  if (leadCourse == null || catalogName == null) return false;
  const leadRaw = String(leadCourse).trim();
  const catalog = String(catalogName).trim();
  if (!leadRaw || !catalog) return false;

  const leadLabel = normalizeCourseValue(leadRaw) || leadRaw;
  const catalogLabel = normalizeCourseValue(catalog) || catalog;
  if (leadLabel.toLowerCase() === catalogLabel.toLowerCase()) return true;

  const catalogSlug = courseToSlug(catalogLabel);
  if (!catalogSlug) return false;
  if (courseToSlug(leadLabel) === catalogSlug) return true;
  if (courseToSlug(leadRaw) === catalogSlug) return true;

  const slugRe = new RegExp(
    `(^|[/])${escapeRegexLocal(catalogSlug)}([/.?#]|$)`,
    'i'
  );
  if (slugRe.test(leadRaw)) return true;

  const slugUnderscore = catalogSlug.replace(/-/g, '_');
  if (slugUnderscore !== catalogSlug) {
    const underRe = new RegExp(
      `(^|[/])${escapeRegexLocal(slugUnderscore)}([/.?#]|$)`,
      'i'
    );
    if (underRe.test(leadRaw)) return true;
  }

  return false;
}

/** Sanitize a sheet header into a stable custom field key. */
export function sanitizeCustomFieldKey(input) {
  if (!input || typeof input !== 'string') return '';
  let key = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  if (!key) key = 'field';
  if (/^[0-9]/.test(key)) key = `f_${key}`;
  key = key.slice(0, CUSTOM_FIELD_LIMITS.maxKeyLength);

  if (SYSTEM_LEAD_FIELD_KEYS.has(key)) {
    key = `x_${key}`.slice(0, CUSTOM_FIELD_LIMITS.maxKeyLength);
  }
  return key;
}

export function sanitizeCustomFieldLabel(input, fallback = 'Field') {
  const label = String(input ?? fallback)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, CUSTOM_FIELD_LIMITS.maxLabelLength);
  return label || fallback;
}

export function sanitizeCustomFieldValue(input, { key, label } = {}) {
  let value = String(input ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, CUSTOM_FIELD_LIMITS.maxValueLength);

  // Normalize date columns to ISO YYYY-MM-DD (Excel serial, US/IN strings, etc.)
  if (isLeadDateField(key, label) && value) {
    const d = parseSheetDate(value);
    if (d) value = d.toISOString().slice(0, 10);
  }

  return value;
}

export function buildCustomFieldEntry({ key, label, value }) {
  const safeKey = sanitizeCustomFieldKey(key);
  if (!safeKey) return null;
  const safeLabel = sanitizeCustomFieldLabel(label, key);
  return {
    key: safeKey,
    label: safeLabel,
    value: sanitizeCustomFieldValue(value, { key: safeKey, label: safeLabel }),
  };
}

/** Merge custom field arrays by key (incoming overwrites). Cap at maxFields. */
export function mergeCustomFields(existing = [], incoming = []) {
  const map = new Map();
  for (const item of existing) {
    if (!item?.key) continue;
    map.set(item.key, {
      key: item.key,
      label: sanitizeCustomFieldLabel(item.label, item.key),
      value: sanitizeCustomFieldValue(item.value, { key: item.key, label: item.label }),
    });
  }
  for (const item of incoming) {
    const entry = buildCustomFieldEntry(item);
    if (!entry) continue;
    map.set(entry.key, entry);
  }
  return Array.from(map.values()).slice(0, CUSTOM_FIELD_LIMITS.maxFields);
}

/** Pick only allowed system fields + customFields for Lead persistence. */
export function pickPersistableLeadFields(fields = {}) {
  const allowed = [
    'name',
    'phone',
    'email',
    'course',
    'source',
    'priority',
    'status',
    'address',
    'department',
    'assignedTo',
  ];
  const out = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) out[key] = fields[key];
  }
  if (out.course !== undefined) {
    out.course = normalizeCourseValue(out.course);
  }
  if (Array.isArray(fields.customFields) && fields.customFields.length) {
    out.customFields = mergeCustomFields([], fields.customFields);
  }
  const resolved = resolveLeadDate({
    customFields: out.customFields || fields.customFields,
    importMeta: fields.importMeta,
    leadDate: fields.leadDate,
    createdAt: fields.createdAt,
  });
  if (resolved) out.leadDate = resolved;
  return out;
}
