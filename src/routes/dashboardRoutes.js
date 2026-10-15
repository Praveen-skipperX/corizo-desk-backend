import { Router } from 'express';
import { getDashboard, getActivityLogs, globalSearch } from '../controllers/dashboardController.js';
import { authenticate, employeeScope, activityLogScope, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { paginationSchema } from '../validators/schemas.js';

const router = Router();

router.use(authenticate);

router.get('/dashboard', requirePermission('dashboard.view'), employeeScope, getDashboard);
router.get('/search', requirePermission('leads.view'), employeeScope, globalSearch);
router.get('/activity-logs', requirePermission('audit.view'), activityLogScope, validate(paginationSchema), getActivityLogs);

export default router;
