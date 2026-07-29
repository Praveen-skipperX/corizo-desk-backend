import { asyncHandler } from '../utils/apiResponse.js';
import { Lead, FollowUp, DealClosure, ActivityLog, User } from '../models/index.js';
import { buildLeadScopeFilter } from '../utils/leadAccess.js';
import { ROLES } from '../constants/index.js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const buildDateFilter = (dateFrom, dateTo, field = 'createdAt') => {
  const filter = {};
  if (dateFrom || dateTo) {
    filter[field] = {};
    if (dateFrom) filter[field].$gte = new Date(dateFrom);
    if (dateTo) filter[field].$lte = new Date(dateTo);
  }
  return filter;
};

const getReportData = async (type, filters, user) => {
  const dateFilter = buildDateFilter(filters.dateFrom, filters.dateTo);
  const scopeFilter = buildLeadScopeFilter(user);

  if (filters.department && user.role === 'super_admin') {
    scopeFilter.department = filters.department;
  }

  switch (type) {
    case 'lead':
    case 'source':
    case 'course':
      return Lead.find({ isDeleted: false, ...scopeFilter, ...dateFilter })
        .populate('department assignedTo createdBy', 'name email')
        .sort({ createdAt: -1 })
        .lean();
    case 'follow_up':
      return FollowUp.find({ ...scopeFilter, ...buildDateFilter(filters.dateFrom, filters.dateTo, 'scheduledDate') })
        .populate('lead assignedTo', 'leadId name email')
        .sort({ scheduledDate: -1 })
        .lean();
    case 'revenue':
      return DealClosure.find({ status: 'active', ...scopeFilter, ...buildDateFilter(filters.dateFrom, filters.dateTo, 'closureDate') })
        .populate('department closedBy', 'name email')
        .sort({ closureDate: -1 })
        .lean();
    case 'employee':
    case 'counselor':
      return User.find({
        role: ROLES.EMPLOYEE,
        isActive: true,
        ...scopeFilter.department ? { department: scopeFilter.department } : {},
      })
        .populate('department', 'name')
        .lean();
    case 'audit':
      const actFilter = user.role === ROLES.SUPER_ADMIN ? {} : user.role === ROLES.ADMIN ? { department: user.department._id || user.department } : { user: user._id };
      return ActivityLog.find({ ...actFilter, ...dateFilter })
        .populate('user department', 'name email')
        .sort({ createdAt: -1 })
        .limit(5000)
        .lean();
    default:
      return [];
  }
};

const exportExcel = async (res, data, type, filename) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(type);

  if (data.length === 0) {
    sheet.addRow(['No data found']);
  } else if (type === 'lead') {
    sheet.columns = [
      { header: 'Lead ID', key: 'leadId', width: 15 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Priority', key: 'priority', width: 10 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Assigned To', key: 'assignedTo', width: 20 },
      { header: 'Created At', key: 'createdAt', width: 20 },
    ];
    data.forEach((row) => {
      sheet.addRow({
        leadId: row.leadId,
        name: row.name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        priority: row.priority,
        department: row.department?.name,
        assignedTo: row.assignedTo?.name,
        createdAt: row.createdAt,
      });
    });
  } else if (type === 'revenue') {
    sheet.columns = [
      { header: 'Lead Ref', key: 'leadRef', width: 15 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Closed By', key: 'closedBy', width: 20 },
      { header: 'Closure Date', key: 'closureDate', width: 20 },
    ];
    data.forEach((row) => {
      sheet.addRow({
        leadRef: row.leadRef,
        name: row.name,
        amount: row.amount,
        department: row.department?.name,
        closedBy: row.closedBy?.name,
        closureDate: row.closureDate,
      });
    });
  } else {
    sheet.addRow(Object.keys(data[0]));
    data.forEach((row) => sheet.addRow(Object.values(row)));
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}.xlsx`);
  await workbook.xlsx.write(res);
};

const exportCsv = (res, data, type, filename) => {
  let csv = '';
  if (type === 'lead' && data.length) {
    csv = 'Lead ID,Name,Email,Phone,Status,Priority,Department,Assigned To,Created At\n';
    data.forEach((row) => {
      csv += `"${row.leadId}","${row.name}","${row.email || ''}","${row.phone}","${row.status}","${row.priority}","${row.department?.name || ''}","${row.assignedTo?.name || ''}","${row.createdAt}"\n`;
    });
  } else if (type === 'revenue' && data.length) {
    csv = 'Lead Ref,Name,Amount,Department,Closed By,Closure Date\n';
    data.forEach((row) => {
      csv += `"${row.leadRef}","${row.name}","${row.amount}","${row.department?.name || ''}","${row.closedBy?.name || ''}","${row.closureDate}"\n`;
    });
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}.csv`);
  res.send(csv);
};

const exportPdf = (res, data, type, filename) => {
  const doc = new PDFDocument({ margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}.pdf`);
  doc.pipe(res);

  doc.fontSize(20).text(`Corizo Desk - ${type.replace('_', ' ').toUpperCase()} Report`, { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
  doc.moveDown(2);

  if (data.length === 0) {
    doc.text('No data found for the selected criteria.');
  } else {
    data.slice(0, 100).forEach((row, i) => {
      if (type === 'lead') {
        doc.text(`${i + 1}. ${row.leadId} - ${row.name} | ${row.status} | ${row.priority}`);
      } else if (type === 'revenue') {
        doc.text(`${i + 1}. ${row.leadRef} - ${row.name} | INR ${row.amount}`);
      } else {
        doc.text(`${i + 1}. ${JSON.stringify(row).slice(0, 100)}`);
      }
    });
  }

  doc.end();
};

export const generateReport = asyncHandler(async (req, res) => {
  const { type, format = 'excel', ...filters } = req.query;
  const data = await getReportData(type, filters, req.user);
  const filename = `${type}-report-${Date.now()}`;

  switch (format) {
    case 'csv':
      return exportCsv(res, data, type, filename);
    case 'pdf':
      return exportPdf(res, data, type, filename);
    default:
      return exportExcel(res, data, type, filename);
  }
});
