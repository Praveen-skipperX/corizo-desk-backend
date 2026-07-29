/**
 * Frozen permission catalog for Corizo Desk RBAC.
 * Keys: {module}.{action}
 */
export const PERMISSION_SCOPES = {
  GLOBAL: 'global',
  DEPARTMENT: 'department',
  OWN: 'own',
  NONE: 'none',
};

export const PERMISSION_CATALOG = [
  // Dashboard
  { key: 'dashboard.view', module: 'dashboard', action: 'view', description: 'View dashboard' },
  { key: 'dashboard.view_org', module: 'dashboard', action: 'view_org', description: 'View org/department-wide dashboard metrics' },

  // Leads
  { key: 'leads.view', module: 'leads', action: 'view', description: 'View leads' },
  { key: 'leads.create', module: 'leads', action: 'create', description: 'Create leads' },
  { key: 'leads.edit', module: 'leads', action: 'edit', description: 'Edit leads' },
  { key: 'leads.delete', module: 'leads', action: 'delete', description: 'Delete leads' },
  { key: 'leads.assign', module: 'leads', action: 'assign', description: 'Assign leads' },
  { key: 'leads.transfer', module: 'leads', action: 'transfer', description: 'Transfer leads' },
  { key: 'leads.export', module: 'leads', action: 'export', description: 'Export leads' },
  { key: 'leads.import', module: 'leads', action: 'import', description: 'Import leads (Excel)' },
  { key: 'leads.remark', module: 'leads', action: 'remark', description: 'Add remarks' },
  { key: 'leads.admin_remark', module: 'leads', action: 'admin_remark', description: 'Add admin remarks' },
  { key: 'leads.close', module: 'leads', action: 'close', description: 'Close leads' },

  // Follow-ups
  { key: 'follow_ups.view', module: 'follow_ups', action: 'view', description: 'View follow-ups' },
  { key: 'follow_ups.create', module: 'follow_ups', action: 'create', description: 'Schedule follow-ups' },
  { key: 'follow_ups.complete', module: 'follow_ups', action: 'complete', description: 'Complete follow-ups' },
  { key: 'follow_ups.edit', module: 'follow_ups', action: 'edit', description: 'Edit follow-ups' },

  // Google Sheets (connector UI)
  { key: 'google_sheets.view', module: 'google_sheets', action: 'view', description: 'View connected sheets' },
  { key: 'google_sheets.add', module: 'google_sheets', action: 'add', description: 'Add Google Sheet' },
  { key: 'google_sheets.edit', module: 'google_sheets', action: 'edit', description: 'Edit sheet connection' },
  { key: 'google_sheets.delete', module: 'google_sheets', action: 'delete', description: 'Delete/disable sheet' },
  { key: 'google_sheets.sync', module: 'google_sheets', action: 'sync', description: 'Sync one sheet' },
  { key: 'google_sheets.sync_all', module: 'google_sheets', action: 'sync_all', description: 'Sync all sheets' },
  { key: 'google_sheets.preview', module: 'google_sheets', action: 'preview', description: 'Preview import' },
  { key: 'google_sheets.import', module: 'google_sheets', action: 'import', description: 'Confirm import' },
  { key: 'google_sheets.history', module: 'google_sheets', action: 'history', description: 'View sync history' },
  { key: 'google_sheets.templates', module: 'google_sheets', action: 'templates', description: 'Manage mapping templates' },
  { key: 'google_sheets.settings', module: 'google_sheets', action: 'settings', description: 'Google Sheets settings' },
  { key: 'google_sheets.full_replace', module: 'google_sheets', action: 'full_replace', description: 'Use Full Replace sync mode' },

  // Reports
  { key: 'reports.view', module: 'reports', action: 'view', description: 'View reports' },
  { key: 'reports.export', module: 'reports', action: 'export', description: 'Export reports' },

  // Users
  { key: 'users.view', module: 'users', action: 'view', description: 'View users' },
  { key: 'users.create', module: 'users', action: 'create', description: 'Create users' },
  { key: 'users.edit', module: 'users', action: 'edit', description: 'Edit users' },
  { key: 'users.delete', module: 'users', action: 'delete', description: 'Delete/deactivate users' },
  { key: 'users.unlock', module: 'users', action: 'unlock', description: 'Unlock accounts' },
  { key: 'users.reset_password', module: 'users', action: 'reset_password', description: 'Reset user passwords' },

  // Departments
  { key: 'departments.view', module: 'departments', action: 'view', description: 'View departments' },
  { key: 'departments.create', module: 'departments', action: 'create', description: 'Create departments' },
  { key: 'departments.edit', module: 'departments', action: 'edit', description: 'Edit departments' },
  { key: 'departments.delete', module: 'departments', action: 'delete', description: 'Delete departments' },

  // Audit
  { key: 'audit.view', module: 'audit', action: 'view', description: 'View audit logs' },
  { key: 'audit.view_all', module: 'audit', action: 'view_all', description: 'View all audit logs' },

  // Security
  { key: 'security.view', module: 'security', action: 'view', description: 'View security module' },
  { key: 'security.manage', module: 'security', action: 'manage', description: 'Manage security operations' },

  // Settings
  { key: 'settings.view', module: 'settings', action: 'view', description: 'View settings' },
  { key: 'settings.edit', module: 'settings', action: 'edit', description: 'Edit own settings' },
  { key: 'settings.system', module: 'settings', action: 'system', description: 'System settings' },

  // Roles
  { key: 'roles.view', module: 'roles', action: 'view', description: 'View roles and permissions' },
  { key: 'roles.manage', module: 'roles', action: 'manage', description: 'Manage roles and permissions' },
];

/**
 * Default role → permission grants with scope.
 * Matches frozen matrix in docs/RBAC_AND_EVENTS.md
 */
export const DEFAULT_ROLE_PERMISSIONS = {
  super_admin: PERMISSION_CATALOG.map((p) => ({
    key: p.key,
    scope: PERMISSION_SCOPES.GLOBAL,
  })),

  admin: [
    { key: 'dashboard.view', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'dashboard.view_org', scope: PERMISSION_SCOPES.DEPARTMENT },

    { key: 'leads.view', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'leads.create', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'leads.edit', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'leads.delete', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'leads.assign', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'leads.transfer', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'leads.export', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'leads.import', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'leads.remark', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'leads.admin_remark', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'leads.close', scope: PERMISSION_SCOPES.DEPARTMENT },

    { key: 'follow_ups.view', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'follow_ups.create', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'follow_ups.complete', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'follow_ups.edit', scope: PERMISSION_SCOPES.DEPARTMENT },

    { key: 'google_sheets.view', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'google_sheets.add', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'google_sheets.edit', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'google_sheets.delete', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'google_sheets.sync', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'google_sheets.sync_all', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'google_sheets.preview', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'google_sheets.import', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'google_sheets.history', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'google_sheets.templates', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'google_sheets.settings', scope: PERMISSION_SCOPES.DEPARTMENT },

    { key: 'reports.view', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'reports.export', scope: PERMISSION_SCOPES.DEPARTMENT },

    { key: 'users.view', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'users.create', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'users.edit', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'users.delete', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'users.unlock', scope: PERMISSION_SCOPES.DEPARTMENT },
    { key: 'users.reset_password', scope: PERMISSION_SCOPES.DEPARTMENT },

    { key: 'departments.view', scope: PERMISSION_SCOPES.DEPARTMENT },

    { key: 'audit.view', scope: PERMISSION_SCOPES.DEPARTMENT },

    { key: 'settings.view', scope: PERMISSION_SCOPES.OWN },
    { key: 'settings.edit', scope: PERMISSION_SCOPES.OWN },
  ],

  employee: [
    { key: 'dashboard.view', scope: PERMISSION_SCOPES.OWN },

    { key: 'leads.view', scope: PERMISSION_SCOPES.OWN },
    { key: 'leads.create', scope: PERMISSION_SCOPES.OWN },
    { key: 'leads.edit', scope: PERMISSION_SCOPES.OWN },
    { key: 'leads.remark', scope: PERMISSION_SCOPES.OWN },
    { key: 'leads.close', scope: PERMISSION_SCOPES.OWN },

    { key: 'follow_ups.view', scope: PERMISSION_SCOPES.OWN },
    { key: 'follow_ups.create', scope: PERMISSION_SCOPES.OWN },
    { key: 'follow_ups.complete', scope: PERMISSION_SCOPES.OWN },
    { key: 'follow_ups.edit', scope: PERMISSION_SCOPES.OWN },

    { key: 'audit.view', scope: PERMISSION_SCOPES.OWN },

    { key: 'settings.view', scope: PERMISSION_SCOPES.OWN },
    { key: 'settings.edit', scope: PERMISSION_SCOPES.OWN },
  ],
};

export const SYSTEM_ROLES = [
  {
    slug: 'super_admin',
    name: 'Super Admin',
    description: 'Full system access across all departments',
    isSystem: true,
  },
  {
    slug: 'admin',
    name: 'Admin',
    description: 'Department-scoped management access',
    isSystem: true,
  },
  {
    slug: 'employee',
    name: 'Employee',
    description: 'Counselor access to own/assigned leads',
    isSystem: true,
  },
];
