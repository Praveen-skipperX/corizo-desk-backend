/**
 * Parse / resolve the lead "Date" column value (sheet date).
 * Handles Excel serials, ISO, and common date strings (US + IN).
 */

const LEAD_DATE_KEY_RE = /^(date|lead_?date|enquiry_?date|inquiry_?date|getting_?date|lead_?getting_?date|submission_?date|submitted_?on)$/i;
const LEAD_DATE_LABEL_RE = /^(date|lead date|enquiry date|inquiry date|getting date|lead getting date|submission date|submitted on)$/i;

export function excelSerialToDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 20000 || n > 100000) return null;
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseSheetDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const asExcel = excelSerialToDate(raw);
    if (asExcel) return asExcel;
  }

  // ISO / RFC first
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  // MM/DD/YYYY (US sheets) — when middle part > 12 it can't be DD/MM
  const us = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (us) {
    const a = Number(us[1]);
    const b = Number(us[2]);
    let year = Number(us[3]);
    if (year < 100) year += 2000;

    let month;
    let day;
    if (a > 12 && b <= 12) {
      // DD/MM/YYYY
      day = a;
      month = b - 1;
    } else if (b > 12 && a <= 12) {
      // MM/DD/YYYY
      month = a - 1;
      day = b;
    } else {
      // Ambiguous — prefer US (sheets often export MM/DD/YYYY)
      month = a - 1;
      day = b;
    }

    const d = new Date(Date.UTC(year, month, day));
    if (
      !Number.isNaN(d.getTime())
      && d.getUTCFullYear() === year
      && d.getUTCMonth() === month
      && d.getUTCDate() === day
    ) {
      return d;
    }
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function isLeadDateField(key, label) {
  return LEAD_DATE_KEY_RE.test(key || '') || LEAD_DATE_LABEL_RE.test(label || '');
}

/** Resolve lead getting-date from customFields / originalRow / createdAt. */
export function resolveLeadDate(lead = {}) {
  const custom = Array.isArray(lead.customFields)
    ? lead.customFields.find((f) => isLeadDateField(f?.key, f?.label))
    : null;
  if (custom?.value != null && custom.value !== '') {
    const d = parseSheetDate(custom.value);
    if (d) return d;
  }

  const row = lead.importMeta?.originalRow;
  if (row && typeof row === 'object') {
    const entry = Object.entries(row).find(([k]) => LEAD_DATE_LABEL_RE.test(String(k).trim()));
    if (entry) {
      const d = parseSheetDate(entry[1]);
      if (d) return d;
    }
  }

  if (lead.leadDate) {
    const d = new Date(lead.leadDate);
    if (!Number.isNaN(d.getTime())) return d;
  }

  if (lead.createdAt) {
    const d = new Date(lead.createdAt);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return null;
}

/** Start/end of day UTC for YYYY-MM-DD filter inputs. */
export function dayBoundsFromInput(dateFrom, dateTo) {
  const range = {};
  if (dateFrom) {
    const from = new Date(`${String(dateFrom).slice(0, 10)}T00:00:00.000Z`);
    if (!Number.isNaN(from.getTime())) range.$gte = from;
  }
  if (dateTo) {
    const to = new Date(`${String(dateTo).slice(0, 10)}T23:59:59.999Z`);
    if (!Number.isNaN(to.getTime())) range.$lte = to;
  }
  return Object.keys(range).length ? range : null;
}
