import { Router } from 'express';
import {
  createFollowUp,
  getFollowUps,
  completeFollowUp,
  addFollowUpDiscussion,
  getFollowUpSummary,
} from '../controllers/followUpController.js';
import { authenticate, employeeScope } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createFollowUpSchema, followUpDiscussionSchema, paginationSchema } from '../validators/schemas.js';

const router = Router();

router.use(authenticate, employeeScope);

router.get('/summary', getFollowUpSummary);
router.route('/')
  .get(validate(paginationSchema), getFollowUps)
  .post(validate(createFollowUpSchema), createFollowUp);

router.patch('/:id/complete', completeFollowUp);
router.post('/:id/discussion', validate(followUpDiscussionSchema), addFollowUpDiscussion);

export default router;
