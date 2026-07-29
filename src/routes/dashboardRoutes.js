import { Router } from 'express';
import { getDashboard, getActivityLogs, globalSearch } from '../controllers/dashboardController.js';
import { authenticate, employeeScope, activityLogScope } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { paginationSchema } from '../validators/schemas.js';

const router = Router();

router.use(authenticate);

router.get('/dashboard', employeeScope, getDashboard);
router.get('/search', employeeScope, globalSearch);
router.get('/activity-logs', activityLogScope, validate(paginationSchema), getActivityLogs);

export default router;
