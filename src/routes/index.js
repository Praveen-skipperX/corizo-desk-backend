import { Router } from 'express';
import authRoutes from './authRoutes.js';
import userRoutes from './userRoutes.js';
import courseRoutes from './courseRoutes.js';
import leadRoutes from './leadRoutes.js';
import followUpRoutes from './followUpRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';
import reportRoutes from './reportRoutes.js';
import settingsRoutes from './settingsRoutes.js';
import exportRoutes from './exportRoutes.js';
import connectorRoutes from './connectorRoutes.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, message: 'Corizo Desk API is running', timestamp: new Date().toISOString() });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/courses', courseRoutes);
router.use('/leads', leadRoutes);
router.use('/follow-ups', followUpRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportRoutes);
router.use('/settings', settingsRoutes);
router.use('/exports', exportRoutes);
router.use('/connectors', connectorRoutes);

export default router;
