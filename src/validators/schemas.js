import { z } from 'zod';
import { ROLES, LEAD_PRIORITIES, LEAD_STATUSES, LEAD_SOURCES } from '../constants/index.js';

export const sendOtpSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
  }),
});

export const employeeLoginSchema = z.object({
  body: z.object({
    email: z.string().min(3, 'Email or username is required'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const otpStatusSchema = z.object({
  query: z.object({
    email: z.string().email('Invalid email address'),
  }),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    email: z.string().email(),
    otp: z.string().length(6, 'OTP must be 6 digits'),
  }),
});

export const superAdminLoginSchema = z.object({
  body: z.object({
    username: z.string().min(3),
    password: z.string().min(8),
  }),
});

export const verifyTotpSchema = z.object({
  body: z.object({
    tempToken: z.string(),
    totpCode: z.string().length(6),
  }),
});

export const createUserSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    phone: z.string().optional(),
    role: z.enum([ROLES.ADMIN, ROLES.EMPLOYEE]),
    department: z.string().optional(),
    password: z.string().min(8).optional(),
    confirmPassword: z.string().optional(),
    passwordMode: z.enum(['manual', 'first_login', 'hybrid']).optional(),
    forcePasswordOnFirstLogin: z.boolean().optional(),
    forcePasswordChangeOnFirstLogin: z.boolean().optional(),
    isActive: z.boolean().optional(),
    /** Connector (Google Sheet) IDs this employee may access. */
    allowedConnectors: z.array(z.string()).optional(),
  }).superRefine((data, ctx) => {
    if (data.role === ROLES.EMPLOYEE && !(data.allowedConnectors?.length)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Select at least one sheet this employee can access',
        path: ['allowedConnectors'],
      });
    }
    if (data.passwordMode === 'manual' || (data.password && !data.passwordMode)) {
      if (!data.password) {
        ctx.addIssue({ code: 'custom', message: 'Password is required', path: ['password'] });
      }
      if (!data.confirmPassword) {
        ctx.addIssue({ code: 'custom', message: 'Confirm password is required', path: ['confirmPassword'] });
      }
      if (data.password && data.confirmPassword && data.password !== data.confirmPassword) {
        ctx.addIssue({ code: 'custom', message: 'Passwords do not match', path: ['confirmPassword'] });
      }
    }
    if (data.passwordMode === 'hybrid') {
      if (!data.password) {
        ctx.addIssue({ code: 'custom', message: 'Temporary password is required', path: ['password'] });
      }
      if (!data.confirmPassword) {
        ctx.addIssue({ code: 'custom', message: 'Confirm password is required', path: ['confirmPassword'] });
      }
    }
  }),
});

export const setupPasswordSchema = z.object({
  body: z.object({
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  }).refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }),
});

export const updateUserSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().min(2).max(100).optional(),
    phone: z.string().optional(),
    department: z.string().optional(),
    isActive: z.boolean().optional(),
    role: z.enum([ROLES.ADMIN, ROLES.EMPLOYEE]).optional(),
    allowedConnectors: z.array(z.string()).optional(),
  }),
});

export const resetUserPasswordSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
  }).refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  }),
});

export const createDepartmentSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100),
    code: z.string().min(2).max(10),
    description: z.string().optional(),
  }),
});

export const createCourseSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(150),
    code: z.string().min(2).max(40).optional(),
    category: z.string().max(80).optional(),
    description: z.string().max(500).optional(),
    sortOrder: z.coerce.number().int().optional(),
  }),
});

export const updateCourseSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().min(2).max(150).optional(),
    category: z.string().max(80).optional().nullable(),
    description: z.string().max(500).optional().nullable(),
    sortOrder: z.coerce.number().int().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const createLeadSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().trim().min(10),
    course: z.string().optional(),
    address: z.object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional(),
      country: z.string().optional(),
    }).optional(),
    source: z.enum(Object.values(LEAD_SOURCES)).optional(),
    department: z.string().optional(),
    assignedTo: z.string().optional(),
    priority: z.enum(Object.values(LEAD_PRIORITIES)).optional(),
    status: z.enum(Object.values(LEAD_STATUSES)).optional(),
    nextFollowUpDate: z.string().datetime().optional().or(z.literal('')),
    creatorRemark: z.string().trim().min(1, 'Remark is required'),
    adminRemark: z.string().trim().optional(),
    dealAmount: z.number().min(0).optional(),
    dealNotes: z.string().optional(),
  }),
});

export const updateLeadSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().min(10).optional(),
    course: z.string().optional(),
    address: z.object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional(),
      country: z.string().optional(),
    }).optional(),
    priority: z.enum(Object.values(LEAD_PRIORITIES)).optional(),
    status: z.enum(Object.values(LEAD_STATUSES)).optional(),
    assignedTo: z.string().optional(),
    nextFollowUpDate: z.string().datetime().optional().nullable(),
    dealAmount: z.number().min(0).optional(),
    dealNotes: z.string().optional(),
    adminRemark: z.string().trim().optional(),
    creatorRemark: z.string().trim().min(1).max(5000).optional(),
  }),
});

export const assignLeadSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    assignedTo: z.string(),
    notes: z.string().optional(),
    reason: z.string().optional(),
  }),
});

export const transferLeadSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    toDepartment: z.string(),
    reason: z.string().min(5),
  }),
});

export const createRemarkSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    content: z.string().min(1).max(5000),
    isInternal: z.boolean().optional(),
    relatedStatus: z.string().optional(),
    previousStatus: z.string().optional(),
  }),
});

export const followUpDiscussionSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    notes: z.string().trim().min(1).max(5000),
  }),
});

export const createFollowUpSchema = z.object({
  body: z.object({
    lead: z.string(),
    scheduledDate: z.string().datetime(),
    notes: z.string().optional(),
    assignedTo: z.string().optional(),
    creatorRemark: z.string().min(1, 'Remark is required'),
  }),
});

export const scheduleLeadFollowUpSchema = z.object({
  body: z.object({
    scheduledDate: z.string().datetime(),
    notes: z.string().max(2000).optional(),
  }).refine(
    (data) => new Date(data.scheduledDate) > new Date(),
    { message: 'Follow-up date must be in the future', path: ['scheduledDate'] }
  ),
});

export const paginationSchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    search: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    department: z.string().optional(),
    assignedTo: z.string().optional(),
    scope: z.enum(['all', 'assigned', 'created']).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    source: z.string().optional(),
    course: z.string().optional(),
    connectorId: z.string().optional(),
  }),
});

export const reportSchema = z.object({
  query: z.object({
    type: z.enum(['lead', 'follow_up', 'revenue', 'employee', 'department', 'audit']),
    format: z.enum(['excel', 'csv', 'pdf']).default('excel'),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    department: z.string().optional(),
    employee: z.string().optional(),
  }),
});

export const websiteLeadSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    email: z.string().email().optional(),
    phone: z.string().min(10),
    address: z.object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      pincode: z.string().optional(),
    }).optional(),
    sourceDetails: z.object({
      externalId: z.string().optional(),
      url: z.string().optional(),
      campaign: z.string().optional(),
    }).optional(),
    departmentCode: z.string().optional(),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    phone: z.string().optional(),
    avatar: z.string().url().optional().or(z.literal('')),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8),
    password: z.string().optional(),
    totpCode: z.string().optional(),
    emailOtp: z.string().optional(),
  }),
});

export const emailChangeSchema = z.object({
  body: z.object({
    newEmail: z.string().email(),
    password: z.string().optional(),
    totpCode: z.string().optional(),
    emailOtp: z.string().optional(),
  }),
});

export const verifyEmailChangeSchema = z.object({
  body: z.object({
    otp: z.string().length(6),
  }),
});

export const mfaPreferenceSchema = z.object({
  body: z.object({
    mfaPreference: z.enum(['otp', 'totp', 'both']).optional(),
    emailOtpEnabled: z.boolean().optional(),
    password: z.string().optional(),
    totpCode: z.string().optional(),
    emailOtp: z.string().optional(),
  }),
});

export const totpVerifySchema = z.object({
  body: z.object({
    totpCode: z.string().length(6),
  }),
});

export const exportPreviewSchema = z.object({
  query: z.object({
    fields: z.string().optional(),
    preset: z.enum(['emails', 'phones', 'contact', 'full']).optional(),
    format: z.enum(['excel', 'csv', 'pdf']).optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    department: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    search: z.string().optional(),
  }),
});

export const exportExecuteSchema = z.object({
  body: z.object({
    format: z.enum(['excel', 'csv', 'pdf']).default('csv'),
    preset: z.enum(['emails', 'phones', 'contact', 'full']).optional(),
    fields: z.array(z.string()).optional(),
    password: z.string().optional(),
    totpCode: z.string().optional(),
    emailOtp: z.string().optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    department: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    search: z.string().optional(),
  }),
});

const fieldMappingItem = z.object({
  sourceColumn: z.string().min(1).max(200),
  targetField: z.string().min(1).max(80),
  required: z.boolean().optional(),
  customKey: z.string().max(64).optional(),
  customLabel: z.string().max(100).optional(),
});

export const createConnectorSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120),
    type: z.string().optional(),
    spreadsheetUrl: z.string().optional(),
    worksheetName: z.string().optional(),
    department: z.string().optional(),
    defaultLeadSource: z.string().optional(),
    defaultAssignedUser: z.string().optional().nullable(),
    defaultLeadStatus: z.string().optional(),
    defaultPriority: z.string().optional(),
    autoSyncEnabled: z.boolean().optional(),
    syncIntervalMinutes: z.number().int().min(5).optional(),
    syncMode: z.enum(['insert_only', 'insert_update', 'full_replace']).optional(),
    duplicateRule: z
      .object({
        type: z.enum(['phone', 'email', 'phone_email', 'custom_column']),
        customField: z.string().optional(),
      })
      .optional(),
    fieldMapping: z.array(fieldMappingItem).optional(),
    uniqueKeyColumn: z.string().optional(),
    headerRow: z.number().int().min(1).optional(),
    mappingTemplateId: z.string().optional(),
    saveAsTemplate: z.boolean().optional(),
    templateName: z.string().optional(),
    config: z.record(z.any()).optional(),
  }),
});

export const updateConnectorSchema = z.object({
  params: z.object({ id: z.string() }),
  body: createConnectorSchema.shape.body.partial(),
});

export const connectorIdParamSchema = z.object({
  params: z.object({ id: z.string() }),
});

export const fetchHeadersSchema = z.object({
  body: z.object({
    spreadsheetUrl: z.string().optional(),
    worksheetName: z.string().optional(),
    headerRow: z.number().int().min(1).optional(),
    connectorId: z.string().optional(),
  }),
});

export const confirmImportSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    previewId: z.string().optional(),
  }),
});

export const createMappingTemplateSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120),
    connectorType: z.string().optional(),
    fieldMapping: z.array(fieldMappingItem).min(1),
    uniqueKeyColumn: z.string().optional(),
    headerRow: z.number().int().min(1).optional(),
    department: z.string().optional(),
  }),
});
