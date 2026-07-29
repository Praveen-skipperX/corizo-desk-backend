import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import {
  createLead,
  listLeads,
  getLead,
  updateLead,
  softDeleteLead,
  bulkSoftDeleteLeads,
  softDeleteAllLeads,
  assignLead,
  requestTransfer,
  importLeads,
  getImportTemplate,
  getImportHistory,
  createWebsiteLead,
  getFollowUpDashboard,
  trackCommunication,
  scheduleLeadFollowUp,
} from '../controllers/leadController.js';
import {
  addCreatorRemark,
  updateCreatorRemark,
  addAdminRemark,
} from '../controllers/remarkController.js';
import { authenticate, authorize, employeeScope, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createLeadSchema,
  updateLeadSchema,
  assignLeadSchema,
  transferLeadSchema,
  createRemarkSchema,
  paginationSchema,
  websiteLeadSchema,
  scheduleLeadFollowUpSchema,
} from '../validators/schemas.js';
import { ROLES } from '../constants/index.js';

// Vercel serverless FS is read-only except /tmp
const uploadDir = process.env.VERCEL ? path.join('/tmp', 'uploads') : 'uploads';
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.xls', '.xlsx'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files allowed'));
    }
  },
});

const router = Router();

router.post('/website', validate(websiteLeadSchema), createWebsiteLead);

router.use(authenticate, employeeScope);

router.get('/follow-ups/dashboard', getFollowUpDashboard);
router.get('/import/template', getImportTemplate);
router.get('/import/history', getImportHistory);
router.post('/import', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), upload.single('file'), importLeads);

router.route('/')
  .get(validate(paginationSchema), listLeads)
  .post(validate(createLeadSchema), createLead);

router.post(
  '/bulk-delete',
  authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  requirePermission('leads.delete'),
  bulkSoftDeleteLeads
);
router.post(
  '/delete-all',
  authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  requirePermission('leads.delete'),
  softDeleteAllLeads
);

router.route('/:id')
  .get(getLead)
  .patch(validate(updateLeadSchema), updateLead)
  .delete(authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), requirePermission('leads.delete'), softDeleteLead);

router.post('/:id/assign', validate(assignLeadSchema), assignLead);
router.post('/:id/communication', trackCommunication);
router.post('/:id/next-follow-up', validate(scheduleLeadFollowUpSchema), scheduleLeadFollowUp);
router.post('/:id/transfer', validate(transferLeadSchema), requestTransfer);
router.post('/:id/creator-remarks', validate(createRemarkSchema), addCreatorRemark);
router.patch('/:id/creator-remarks/:remarkId', validate(createRemarkSchema), updateCreatorRemark);
router.post('/:id/admin-remarks', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), validate(createRemarkSchema), addAdminRemark);

export default router;
