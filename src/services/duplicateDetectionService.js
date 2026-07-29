import crypto from 'crypto';
import { Lead } from '../models/index.js';
import { DUPLICATE_RULES } from '../constants/index.js';

export const normalizePhone = (phone) =>
  String(phone || '').replace(/\D/g, '').replace(/^91/, '').slice(-10);

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

/**
 * Build an in-memory duplicate index once per sync (avoids N full-table scans).
 */
export const buildDuplicateIndex = async ({ duplicateRule, departmentId }) => {
  const rule = duplicateRule?.type || DUPLICATE_RULES.PHONE_EMAIL;
  const base = { isDeleted: false };
  if (departmentId) base.department = departmentId;

  const leads = await Lead.find(base)
    .select('phone email leadId name importMeta')
    .lean();

  const byPhone = new Map();
  const byEmail = new Map();
  const byRowKey = new Map();

  for (const lead of leads) {
    const phone = normalizePhone(lead.phone);
    const email = normalizeEmail(lead.email);
    const rowKey = lead.importMeta?.externalRef?.rowKey;
    if (phone && !byPhone.has(phone)) byPhone.set(phone, lead);
    if (email && !byEmail.has(email)) byEmail.set(email, lead);
    if (rowKey && !byRowKey.has(String(rowKey))) byRowKey.set(String(rowKey), lead);
  }

  return { rule, customField: duplicateRule?.customField || 'rowKey', byPhone, byEmail, byRowKey };
};

/**
 * O(1) duplicate lookup against a prebuilt index.
 */
export const findDuplicateInIndex = (index, leadFields) => {
  if (!index) return null;
  const phone = normalizePhone(leadFields.phone);
  const email = normalizeEmail(leadFields.email);
  const rowKey = leadFields._rowKey || leadFields[index.customField];

  if (index.rule === DUPLICATE_RULES.PHONE) {
    return phone ? index.byPhone.get(phone) || null : null;
  }
  if (index.rule === DUPLICATE_RULES.EMAIL) {
    return email ? index.byEmail.get(email) || null : null;
  }
  if (index.rule === DUPLICATE_RULES.CUSTOM_COLUMN) {
    if (!rowKey) return null;
    return index.byRowKey.get(String(rowKey)) || null;
  }

  // phone_email default
  if (email) {
    const byEmail = index.byEmail.get(email);
    if (byEmail) return byEmail;
  }
  if (phone) {
    return index.byPhone.get(phone) || null;
  }
  return null;
};

/**
 * Find an existing lead matching the connector duplicate rule (OR for phone_email).
 * Prefer buildDuplicateIndex + findDuplicateInIndex for bulk imports.
 */
export const findDuplicateLead = async ({ leadFields, duplicateRule, departmentId, excludeId }) => {
  const index = await buildDuplicateIndex({ duplicateRule, departmentId });
  const hit = findDuplicateInIndex(index, leadFields);
  if (hit && excludeId && String(hit._id) === String(excludeId)) return null;
  return hit;
};

export const buildDuplicateHash = (phone, email) =>
  crypto
    .createHash('md5')
    .update(`${normalizePhone(phone)}-${normalizeEmail(email)}`)
    .digest('hex');

export default {
  findDuplicateLead,
  buildDuplicateHash,
  buildDuplicateIndex,
  findDuplicateInIndex,
  normalizePhone,
  normalizeEmail,
};
