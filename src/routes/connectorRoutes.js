import { Router } from 'express';
import {
  listConnectorTypesHandler,
  listConnectors,
  getConnector,
  createConnector,
  updateConnector,
  disableConnector,
  enableConnector,
  deleteConnector,
  getConnectorHealth,
  fetchConnectorHeaders,
  previewSync,
  confirmImport,
  syncConnector,
  syncAllConnectors,
  getSyncProgress,
  listSyncLogs,
  getConnectorDashboard,
  getGoogleSheetsSetup,
  listMappingTemplates,
  createMappingTemplate,
  deleteMappingTemplate,
} from '../controllers/connectorController.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createConnectorSchema,
  updateConnectorSchema,
  connectorIdParamSchema,
  fetchHeadersSchema,
  confirmImportSchema,
  createMappingTemplateSchema,
} from '../validators/schemas.js';

const router = Router();

router.use(authenticate);

router.get('/types', requirePermission('google_sheets.view'), listConnectorTypesHandler);
router.get('/setup', requirePermission('google_sheets.settings', 'google_sheets.view', 'google_sheets.add'), getGoogleSheetsSetup);
router.get('/dashboard', requirePermission('google_sheets.view'), getConnectorDashboard);
router.get('/sync-progress', requirePermission('google_sheets.sync', 'google_sheets.sync_all', 'google_sheets.view'), getSyncProgress);
router.get('/sync-logs', requirePermission('google_sheets.history'), listSyncLogs);
router.post('/sync-all', requirePermission('google_sheets.sync_all'), syncAllConnectors);
router.post('/headers', requirePermission('google_sheets.add', 'google_sheets.edit'), validate(fetchHeadersSchema), fetchConnectorHeaders);

router.get('/templates', requirePermission('google_sheets.templates'), listMappingTemplates);
router.post('/templates', requirePermission('google_sheets.templates'), validate(createMappingTemplateSchema), createMappingTemplate);
router.delete('/templates/:id', requirePermission('google_sheets.templates'), deleteMappingTemplate);

router.get('/', requirePermission('google_sheets.view'), listConnectors);
router.post('/', requirePermission('google_sheets.add'), validate(createConnectorSchema), createConnector);
router.get('/:id', requirePermission('google_sheets.view'), validate(connectorIdParamSchema), getConnector);
router.patch('/:id', requirePermission('google_sheets.edit'), validate(updateConnectorSchema), updateConnector);
router.post('/:id/disable', requirePermission('google_sheets.edit'), validate(connectorIdParamSchema), disableConnector);
router.post('/:id/enable', requirePermission('google_sheets.edit'), validate(connectorIdParamSchema), enableConnector);
router.delete('/:id', requirePermission('google_sheets.delete'), validate(connectorIdParamSchema), deleteConnector);
router.get('/:id/health', requirePermission('google_sheets.view'), validate(connectorIdParamSchema), getConnectorHealth);
router.post('/:id/preview', requirePermission('google_sheets.preview'), validate(connectorIdParamSchema), previewSync);
router.post('/:id/import', requirePermission('google_sheets.import'), validate(confirmImportSchema), confirmImport);
router.post('/:id/sync', requirePermission('google_sheets.sync'), validate(connectorIdParamSchema), syncConnector);

export default router;
