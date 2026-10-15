import { Router } from 'express';
import {
  createFollowUp,
  getFollowUps,
  completeFollowUp,
  addFollowUpDiscussion,
  getFollowUpSummary,
} from '../controllers/followUpController.js';
import { authenticate, employeeScope, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createFollowUpSchema, completeFollowUpSchema, followUpDiscussionSchema, paginationSchema } from '../validators/schemas.js';

const router = Router();

router.use(authenticate, employeeScope);

router.get('/summary', getFollowUpSummary);
router.route('/')
  .get(requirePermission('follow_ups.view'), validate(paginationSchema), getFollowUps)
  .post(requirePermission('follow_ups.create'), validate(createFollowUpSchema), createFollowUp);

router.patch('/:id/complete', requirePermission('follow_ups.complete'), validate(completeFollowUpSchema), completeFollowUp);
router.post('/:id/discussion', validate(followUpDiscussionSchema), addFollowUpDiscussion);

export default router;
