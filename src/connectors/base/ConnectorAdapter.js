/**
 * Abstract connector adapter contract.
 * Concrete adapters (Google Sheets, Excel, …) implement these methods.
 * Lead persistence must go through leadImportService — never from adapters.
 */
import {
  buildCustomFieldEntry,
  CUSTOM_FIELD_LIMITS,
  SYSTEM_LEAD_FIELD_KEYS,
} from '../../utils/customFields.js';

export const CUSTOM_TARGET = '__custom__';

export default class ConnectorAdapter {
  constructor(type) {
    this.type = type;
  }

  /** @returns {Promise<void>} */
  async validateConfig(_config) {
    throw new Error(`${this.type}: validateConfig not implemented`);
  }

  /**
   * @returns {Promise<{ apiStatus: string, permissionStatus: string, connectionStatus: string, message?: string }>}
   */
  async testConnection(_connector) {
    throw new Error(`${this.type}: testConnection not implemented`);
  }

  /** @returns {Promise<string[]>} */
  async fetchHeaders(_connector) {
    throw new Error(`${this.type}: fetchHeaders not implemented`);
  }

  /**
   * @returns {Promise<{ headers: string[], rows: Record<string, string>[], meta?: object }>}
   */
  async fetchRows(_connector, _options = {}) {
    throw new Error(`${this.type}: fetchRows not implemented`);
  }

  /**
   * Map a raw row to lead fields using connector.fieldMapping.
   * Custom (confirmed) columns become leadFields.customFields[].
   * @returns {{ leadFields: object, errors: Array<{ field: string, message: string }>, raw: object }}
   */
  normalizeRow(row, fieldMapping = []) {
    const leadFields = {};
    const customFields = [];
    const errors = [];
    const seenCustomKeys = new Set();

    for (const map of fieldMapping) {
      const rawValue = row[map.sourceColumn];
      const value = rawValue == null ? '' : String(rawValue).trim();
      if (map.required && !value) {
        errors.push({ field: map.targetField, message: `${map.sourceColumn} is required` });
        continue;
      }
      if (!value) continue;

      const isCustom = map.targetField === CUSTOM_TARGET || map.targetField === 'custom';
      if (isCustom) {
        if (customFields.length >= CUSTOM_FIELD_LIMITS.maxFields) continue;
        const entry = buildCustomFieldEntry({
          key: map.customKey || map.sourceColumn,
          label: map.customLabel || map.sourceColumn,
          value,
        });
        if (!entry || seenCustomKeys.has(entry.key)) continue;
        // Never allow custom keys that collide with system fields after sanitize
        if (SYSTEM_LEAD_FIELD_KEYS.has(entry.key) && !entry.key.startsWith('x_')) continue;
        seenCustomKeys.add(entry.key);
        customFields.push(entry);
        continue;
      }

      // Only allow known system targets from mapping (ignore arbitrary targetField injection)
      if (!SYSTEM_LEAD_FIELD_KEYS.has(map.targetField)) continue;
      if (map.targetField === 'customFields') continue;
      leadFields[map.targetField] = value;
    }

    if (customFields.length) {
      leadFields.customFields = customFields;
    }

    return { leadFields, errors, raw: row };
  }

  /**
   * Stable identity for a row (used for update / full-replace tracking).
   */
  getRowIdentity(row, connector) {
    const keyCol = connector.uniqueKeyColumn;
    if (keyCol && row[keyCol] != null && String(row[keyCol]).trim()) {
      return String(row[keyCol]).trim().toLowerCase();
    }
    const phoneMap = connector.fieldMapping?.find((m) => m.targetField === 'phone');
    const emailMap = connector.fieldMapping?.find((m) => m.targetField === 'email');
    const phone = phoneMap ? String(row[phoneMap.sourceColumn] || '').trim() : '';
    const email = emailMap ? String(row[emailMap.sourceColumn] || '').trim().toLowerCase() : '';
    if (phone || email) return `${phone}|${email}`;
    return null;
  }
}
