import { AppError, asyncHandler, successResponse } from '../utils/apiResponse.js';
import config from '../config/index.js';
import {
  CreatorRemark,
  AdminRemark,
  Lead,
  FollowUp,
  ActivityLog,
  DealClosure,
} from '../models/index.js';
import { ROLES, ACTIVITY_ACTIONS, ENTITY_TYPES } from '../constants/index.js';
import { logActivity } from '../services/auditService.js';
import { invalidateLeadCache } from '../services/redisService.js';
import { assertLeadAccess } from '../utils/leadAccess.js';
import { isAdminRemarksEnabled } from '../services/appSettingsService.js';

export const addCreatorRemark = asyncHandler(async (req, res) => {
  const lead = await assertLeadAccess(req.user, req.params.id, Lead);

  if ([ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role)) {
    const creatorId = lead.createdBy?._id?.toString() || lead.createdBy?.toString();
    if (creatorId !== req.user._id.toString()) {
      throw new AppError('Admins can only add remarks on leads they created', 403);
    }
  }

  const remark = await CreatorRemark.create({
    lead: lead._id,
    content: req.body.content,
    createdBy: req.user._id,
    authorName: req.user.name,
    authorRole: req.user.role,
    relatedStatus: req.body.relatedStatus || lead.status,
    previousStatus: req.body.previousStatus || undefined,
  });

  lead.lastActivityAt = new Date();
  await lead.save();
  await invalidateLeadCache(lead._id.toString());

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.REMARK_ADD,
    entityType: ENTITY_TYPES.REMARK,
    entityId: remark._id,
    metadata: { type: 'creator' },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, remark, 'Creator remark added', 201);
});

export const updateCreatorRemark = asyncHandler(async (req, res) => {
  const remark = await CreatorRemark.findById(req.params.remarkId);
  if (!remark) throw new AppError('Remark not found', 404);

  await assertLeadAccess(req.user, remark.lead.toString(), Lead);

  if (remark.createdBy.toString() !== req.user._id.toString()) {
    throw new AppError('Only the creator can edit this remark', 403);
  }

  const editWindowMs = config.creatorRemarkEditWindowMinutes * 60 * 1000;
  if (Date.now() - new Date(remark.createdAt).getTime() > editWindowMs) {
    throw new AppError(`Edit window expired (${config.creatorRemarkEditWindowMinutes} minutes)`, 403);
  }

  remark.editHistory.push({ content: remark.content, editedAt: new Date() });
  remark.content = req.body.content;
  await remark.save();
  await invalidateLeadCache(remark.lead.toString());

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.UPDATE,
    entityType: ENTITY_TYPES.REMARK,
    entityId: remark._id,
    metadata: { type: 'creator_edit' },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, remark, 'Remark updated');
});

export const addAdminRemark = asyncHandler(async (req, res) => {
  if (!(await isAdminRemarksEnabled())) {
    throw new AppError('Admin remarks are disabled in system settings', 403, 'ADMIN_REMARKS_DISABLED');
  }

  if (![ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(req.user.role)) {
    throw new AppError('Only Admin or Super Admin can add admin remarks', 403);
  }

  const lead = await assertLeadAccess(req.user, req.params.id, Lead);

  if (req.user.role === ROLES.ADMIN) {
    const adminDept = req.user.department._id?.toString() || req.user.department?.toString();
    if (lead.department.toString() !== adminDept) {
      throw new AppError('Access denied', 403);
    }
  }

  const remark = await AdminRemark.create({
    lead: lead._id,
    content: req.body.content,
    addedBy: req.user._id,
    authorName: req.user.name,
    authorRole: req.user.role,
    department: req.user.department?._id || req.user.department,
    departmentName: req.user.department?.name,
  });

  lead.lastActivityAt = new Date();
  await lead.save();
  await invalidateLeadCache(lead._id.toString());

  await logActivity({
    user: req.user,
    action: ACTIVITY_ACTIONS.REMARK_ADD,
    entityType: ENTITY_TYPES.REMARK,
    entityId: remark._id,
    metadata: { type: 'admin' },
    ipAddress: req.clientIp,
    deviceInfo: req.deviceInfo,
  });

  successResponse(res, remark, 'Admin remark added', 201);
});

export const getLeadTimelines = async (leadId) => {
  const adminEnabled = await isAdminRemarksEnabled();
  const [creatorRemarks, adminRemarks, followUps, activities, dealClosure] = await Promise.all([
    CreatorRemark.find({ lead: leadId }).sort({ createdAt: -1 }),
    adminEnabled
      ? AdminRemark.find({ lead: leadId })
        .populate('department', 'name code')
        .sort({ createdAt: -1 })
      : Promise.resolve([]),
    FollowUp.find({ lead: leadId })
      .populate('assignedTo scheduledBy completedBy discussedBy', 'name email')
      .sort({ createdAt: -1 }),
    ActivityLog.find({ entityId: leadId.toString() })
      .sort({ createdAt: -1 })
      .limit(50),
    DealClosure.findOne({ lead: leadId }).populate('closedBy', 'name email'),
  ]);

  return { creatorRemarks, adminRemarks, followUps, activities, dealClosure };
};
