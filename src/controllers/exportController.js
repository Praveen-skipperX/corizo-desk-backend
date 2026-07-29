import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { AppError, asyncHandler, successResponse } from '../utils/apiResponse.js';
import {
  Lead,
  CreatorRemark,
  AdminRemark,
  ExportLog,
} from '../models/index.js';
import { ACTIVITY_ACTIONS, ENTITY_TYPES } from '../constants/index.js';
import { logActivity } from '../services/auditService.js';
import { buildLeadScopeFilter } from '../utils/leadAccess.js';
import { verifyUserReauth } from '../middleware/verifyReauth.js';
import { buildCourseMatchFilter } from '../utils/customFields.js';
import { dayBoundsFromInput } from '../utils/leadDate.js';
import { isAdminRemarksEnabled } from '../services/appSettingsService.js';
import {
  LEAD_EXPORT_FIELDS,
  EXPORT_PRESETS,
  extractFieldValue,
  hasSensitiveFields,
} from '../utils/exportFields.js';

const parseFields = (fieldsParam, preset) => {
  if (preset && EXPORT_PRESETS[preset]) {
    return EXPORT_PRESETS[preset];
  }
  if (!fieldsParam) {
    throw new AppError('Fields or preset required', 400);
  }
  const fields = Array.isArray(fieldsParam) ? fieldsParam : fieldsParam.split(',').map((f) => f.trim());
  const invalid = fields.filter((f) => !LEAD_EXPORT_FIELDS[f]);
  if (invalid.length) {
    throw new AppError(`Invalid export fields: ${invalid.join(', ')}`, 400);
  }
  return fields;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildLeadFilter = (user, query) => {
  const filter = { isDeleted: false, ...buildLeadScopeFilter(user) };
  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.source) filter.source = query.source;
  if (query.course) {
    const courseClause = buildCourseMatchFilter(query.course);
    if (courseClause) {
      filter.$and = filter.$and || [];
      filter.$and.push(courseClause);
    }
  }
  if (query.connectorId) filter['importMeta.connectorId'] = String(query.connectorId);
  if (query.assignedTo) filter.assignedTo = query.assignedTo;
  if (query.department && user.role === 'super_admin') filter.department = query.department;

  if (query.dateFrom || query.dateTo) {
    const range = dayBoundsFromInput(query.dateFrom, query.dateTo);
    if (range) filter.leadDate = range;
  }

  if (query.search && String(query.search).trim()) {
    const q = String(query.search).trim();
    const escaped = escapeRegex(q);
    const phoneDigits = q.replace(/\D/g, '');
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { name: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { leadId: { $regex: escaped, $options: 'i' } },
        { course: { $regex: escaped, $options: 'i' } },
        {
          phone: {
            $regex: phoneDigits.length >= 3 ? phoneDigits : escaped,
            $options: 'i',
          },
        },
      ],
    });
  }
  return filter;
};

const fetchExportData = async (user, query, fields) => {
  const filter = buildLeadFilter(user, query);
  const leads = await Lead.find(filter)
    .populate('department assignedTo createdBy', 'name email')
    .sort({ createdAt: -1 })
    .lean();

  const needsRemarks = fields.includes('creatorRemark') || fields.includes('adminRemark');
  let remarkMap = {};

  if (needsRemarks && leads.length) {
    const ids = leads.map((i) => i._id);
    const [creatorRemarks, adminRemarks] = await Promise.all([
      CreatorRemark.aggregate([
        { $match: { lead: { $in: ids } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$lead', content: { $first: '$content' } } },
      ]),
      AdminRemark.aggregate([
        { $match: { lead: { $in: ids } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$lead', content: { $first: '$content' } } },
      ]),
    ]);

    remarkMap = {};
    creatorRemarks.forEach((r) => {
      remarkMap[r._id.toString()] = { ...(remarkMap[r._id.toString()] || {}), creatorRemark: r.content };
    });
    adminRemarks.forEach((r) => {
      remarkMap[r._id.toString()] = { ...(remarkMap[r._id.toString()] || {}), adminRemark: r.content };
    });
  }

  return leads.map((lead) => {
    const remarks = remarkMap[lead._id.toString()] || {};
    const row = {};
    fields.forEach((field) => {
      row[field] = extractFieldValue(lead, field, remarks);
    });
    return row;
  });
};

const sendExcel = async (res, rows, fields, filename) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Leads');
  sheet.columns = fields.map((f) => ({
    header: LEAD_EXPORT_FIELDS[f].label,
    key: f,
    width: 20,
  }));
  rows.forEach((row) => sheet.addRow(row));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}.xlsx`);
  await workbook.xlsx.write(res);
};

const sendCsv = (res, rows, fields, filename) => {
  const headers = fields.map((f) => LEAD_EXPORT_FIELDS[f].label);
  let csv = `${headers.map((h) => `"${h}"`).join(',')}\n`;
  rows.forEach((row) => {
    csv += `${fields.map((f) => `"${String(row[f] ?? '').replace(/"/g, '""')}"`).join(',')}\n`;
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}.csv`);
  res.send(csv);
};

const sendPdf = (res, rows, fields, filename) => {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}.pdf`);
  doc.pipe(res);

  doc.fontSize(16).text('Corizo Desk - Lead Export', { align: 'center' });
  doc.moveDown();
  doc.fontSize(9).text(`Generated: ${new Date().toLocaleString()} | Records: ${rows.length}`, { align: 'center' });
  doc.moveDown();

  rows.slice(0, 200).forEach((row, i) => {
    const line = fields.map((f) => `${LEAD_EXPORT_FIELDS[f].label}: ${row[f] ?? ''}`).join(' | ');
    doc.fontSize(8).text(`${i + 1}. ${line}`);
  });

  if (rows.length > 200) {
    doc.moveDown().text(`... and ${rows.length - 200} more records`);
  }

  doc.end();
};

export const getExportConfig = asyncHandler(async (_req, res) => {
  const adminEnabled = await isAdminRemarksEnabled();
  const fields = Object.entries(LEAD_EXPORT_FIELDS)
    .filter(([key]) => adminEnabled || key !== 'adminRemark')
    .map(([key, val]) => ({
      key,
      label: val.label,
      sensitive: val.sensitive,
    }));

  const presets = Object.entries(EXPORT_PRESETS).map(([key, presetFields]) => ({
    key,
    fields: adminEnabled
      ? presetFields
      : presetFields.filter((f) => f !== 'adminRemark'),
  }));

  successResponse(res, {
    fields,
    presets,
    formats: ['excel', 'csv', 'pdf'],
  });
});

export const previewExport = asyncHandler(async (req, res) => {
  const fields = parseFields(req.query.fields, req.query.preset);
  const rows = await fetchExportData(req.user, req.query, fields);

  successResponse(res, {
    recordCount: rows.length,
    fields: fields.map((f) => ({ key: f, label: LEAD_EXPORT_FIELDS[f].label })),
    format: req.query.format || 'csv',
    requiresVerification: hasSensitiveFields(fields),
    sample: rows.slice(0, 3),
  });
});

export const executeExport = asyncHandler(async (req, res) => {
  const { format = 'csv', preset, fields: fieldsBody, password, totpCode, emailOtp, ...filters } = req.body;
  const fields = parseFields(fieldsBody || req.query.fields, preset);

  if (hasSensitiveFields(fields)) {
    await verifyUserReauth(req.user, { password, totpCode, emailOtp });
  }

  const rows = await fetchExportData(req.user, { ...filters, ...req.query }, fields);
  const filename = `leads-export-${Date.now()}`;

  await ExportLog.create({
    user: req.user._id,
    exportType: 'lead',
    format,
    fields,
    recordCount: rows.length,
    filters,
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.EXPORT,
    entityType: ENTITY_TYPES.LEAD,
    metadata: { fields, recordCount: rows.length, format },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  switch (format) {
    case 'excel':
      return sendExcel(res, rows, fields, filename);
    case 'pdf':
      return sendPdf(res, rows, fields, filename);
    default:
      return sendCsv(res, rows, fields, filename);
  }
});
