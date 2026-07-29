export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  EMPLOYEE: 'employee',
};

export const LEAD_PRIORITIES = {
  RED: 'red',
  YELLOW: 'yellow',
  GREEN: 'green',
};

export const LEAD_STATUSES = {
  NEW: 'new',
  ASSIGNED: 'assigned',
  ATTEMPTED: 'attempted',
  CONNECTED: 'connected',
  INTERESTED: 'interested',
  FOLLOW_UP: 'follow_up',
  NOT_INTERESTED: 'not_interested',
  DUPLICATE: 'duplicate',
  SPAM: 'spam',
  CLOSED: 'closed',
};

export const LEAD_SOURCES = {
  WEBSITE: 'website',
  GOOGLE_ADS: 'google_ads',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
  LINKEDIN: 'linkedin',
  WHATSAPP: 'whatsapp',
  REFERRAL: 'referral',
  WALK_IN: 'walk_in',
  MANUAL: 'manual',
};

export const FOLLOW_UP_STATUSES = {
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
};

export const TRANSFER_STATUSES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

export const ACTIVITY_ACTIONS = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  ASSIGN: 'assign',
  REASSIGN: 'reassign',
  TRANSFER: 'transfer',
  STATUS_CHANGE: 'status_change',
  PRIORITY_CHANGE: 'priority_change',
  REMARK_ADD: 'remark_add',
  FOLLOW_UP_CREATE: 'follow_up_create',
  FOLLOW_UP_COMPLETE: 'follow_up_complete',
  DEAL_CLOSE: 'deal_close',
  DEAL_CANCEL: 'deal_cancel',
  CALL_INITIATED: 'call_initiated',
  EMAIL_INITIATED: 'email_initiated',
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  ACCOUNT_LOCK: 'account_lock',
  ACCOUNT_UNLOCK: 'account_unlock',
  OTP_SENT: 'otp_sent',
  OTP_VERIFY: 'otp_verify',
  USER_CREATE: 'user_create',
  USER_UPDATE: 'user_update',
  USER_DEACTIVATE: 'user_deactivate',
  IMPORT: 'import',
  EXPORT: 'export',
  IMPORTED_FROM_CONNECTOR: 'imported_from_connector',
  UPDATED_BY_SYNC: 'updated_by_sync',
  CONNECTOR_SYNC: 'connector_sync',
};

export const ENTITY_TYPES = {
  USER: 'user',
  DEPARTMENT: 'department',
  COURSE: 'course',
  LEAD: 'lead',
  FOLLOW_UP: 'follow_up',
  REMARK: 'remark',
  DEAL_CLOSURE: 'deal_closure',
  IMPORT: 'import',
  CONNECTOR: 'connector',
  SYSTEM: 'system',
};

export const CONNECTOR_TYPES = {
  GOOGLE_SHEETS: 'google_sheets',
  EXCEL: 'excel',
  CSV: 'csv',
  WEBHOOK: 'webhook',
  REST_API: 'rest_api',
  ZOHO: 'zoho',
  HUBSPOT: 'hubspot',
};

export const CONNECTOR_STATUSES = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
  ERROR: 'error',
};

export const DUPLICATE_RULES = {
  PHONE: 'phone',
  EMAIL: 'email',
  PHONE_EMAIL: 'phone_email',
  CUSTOM_COLUMN: 'custom_column',
};

export const SYNC_MODES = {
  INSERT_ONLY: 'insert_only',
  INSERT_UPDATE: 'insert_update',
  FULL_REPLACE: 'full_replace',
};

export const CONNECTOR_HEALTH = {
  CONNECTION: { CONNECTED: 'connected', DISCONNECTED: 'disconnected', UNKNOWN: 'unknown' },
  API: { OK: 'ok', DEGRADED: 'degraded', ERROR: 'error', UNCONFIGURED: 'unconfigured' },
  PERMISSION: { OK: 'ok', DENIED: 'denied', UNKNOWN: 'unknown' },
};

export const LEAD_TARGET_FIELDS = [
  'name',
  'phone',
  'email',
  'course',
  'source',
  'priority',
  'status',
];

export const TIMELINE_EVENT_TYPES = {
  IMPORTED_FROM_CONNECTOR: 'imported_from_connector',
  UPDATED_BY_SYNC: 'updated_by_sync',
  ASSIGNED: 'assigned',
  STATUS_CHANGED: 'status_changed',
  REMARK_ADDED: 'remark_added',
  FOLLOW_UP_SCHEDULED: 'follow_up_scheduled',
  FOLLOW_UP_COMPLETED: 'follow_up_completed',
  TRANSFERRED: 'transferred',
  CLOSED: 'closed',
  CREATED: 'created',
  PRIORITY_CHANGED: 'priority_changed',
};

export const NOTIFICATION_TYPES = {
  LEAD_ASSIGNED: 'lead_assigned',
  FOLLOW_UP_REMINDER: 'follow_up_reminder',
  FOLLOW_UP_OVERDUE: 'follow_up_overdue',
  ACCOUNT_LOCKED: 'account_locked',
  TRANSFER_REQUEST: 'transfer_request',
  TRANSFER_APPROVED: 'transfer_approved',
  LOGIN_ALERT: 'login_alert',
};

export const PRIORITY_ORDER = {
  red: 1,
  yellow: 2,
  green: 3,
};
