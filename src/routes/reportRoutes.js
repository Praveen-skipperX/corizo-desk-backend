import { Router } from 'express';
import { generateReport } from '../controllers/reportController.js';
import { authenticate, employeeScope } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { reportSchema } from '../validators/schemas.js';
import { ROLES } from '../constants/index.js';
import { authorize } from '../middleware/auth.js';

const router = Router();

router.use(authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), employeeScope);

router.get('/', validate(reportSchema), generateReport);

export default router;
