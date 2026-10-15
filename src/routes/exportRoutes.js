import { Router } from 'express';
import { getExportConfig, previewExport, executeExport } from '../controllers/exportController.js';
import { authenticate, employeeScope, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { expensiveRateLimiter } from '../middleware/rateLimiter.js';
import { exportPreviewSchema, exportExecuteSchema } from '../validators/schemas.js';

const router = Router();

router.use(authenticate, employeeScope, requirePermission('leads.export'), expensiveRateLimiter);

router.get('/config', getExportConfig);
router.get('/leads/preview', validate(exportPreviewSchema), previewExport);
router.post('/leads', validate(exportExecuteSchema), executeExport);

export default router;
