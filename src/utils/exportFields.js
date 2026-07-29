import { normalizeCourseValue } from './customFields.js';

export const LEAD_EXPORT_FIELDS = {
  leadId: { label: 'Lead ID', sensitive: false },
  name: { label: 'Name', sensitive: false },
  email: { label: 'Email Address', sensitive: true },
  phone: { label: 'Phone Number', sensitive: true },
  course: { label: 'Course', sensitive: false },
  address: { label: 'Address', sensitive: false },
  priority: { label: 'Priority', sensitive: false },
  status: { label: 'Status', sensitive: false },
  assignedTo: { label: 'Assigned Employee', sensitive: false },
  department: { label: 'Department', sensitive: false },
  nextFollowUpDate: { label: 'Follow-up Date', sensitive: false },
  dealAmount: { label: 'Deal Amount', sensitive: true },
  creatorRemark: { label: 'Remarks', sensitive: false },
  adminRemark: { label: 'Admin Remarks', sensitive: false },
  createdAt: { label: 'Created Date', sensitive: false },
  updatedAt: { label: 'Updated Date', sensitive: false },
};

export const EXPORT_PRESETS = {
  emails: ['email'],
  phones: ['name', 'phone'],
  contact: ['name', 'email', 'phone'],
  full: Object.keys(LEAD_EXPORT_FIELDS),
};

export const formatAddress = (address) => {
  if (!address) return '';
  return [address.street, address.city, address.state, address.pincode, address.country]
    .filter(Boolean)
    .join(', ');
};

export const extractFieldValue = (lead, field, remarks = {}) => {
  switch (field) {
    case 'leadId': return lead.leadId || '';
    case 'name': return lead.name || '';
    case 'email': return lead.email || '';
    case 'phone': return lead.phone || '';
    case 'course': return normalizeCourseValue(lead.course) || '';
    case 'address': return formatAddress(lead.address);
    case 'priority': return lead.priority || '';
    case 'status': return lead.status || '';
    case 'assignedTo': return lead.assignedTo?.name || '';
    case 'department': return lead.department?.name || '';
    case 'nextFollowUpDate': return lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate).toISOString() : '';
    case 'dealAmount': return lead.dealClosure?.amount ?? lead.dealClosure?.amount ?? '';
    case 'creatorRemark': return remarks.creatorRemark || '';
    case 'adminRemark': return remarks.adminRemark || '';
    case 'createdAt': return lead.createdAt ? new Date(lead.createdAt).toISOString() : '';
    case 'updatedAt': return lead.updatedAt ? new Date(lead.updatedAt).toISOString() : '';
    default: return '';
  }
};

export const hasSensitiveFields = (fields) =>
  fields.some((f) => LEAD_EXPORT_FIELDS[f]?.sensitive);
