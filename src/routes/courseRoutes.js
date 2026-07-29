import { Router } from 'express';
import {
  createCourse,
  getCourses,
  getCourseById,
  updateCourse,
  deactivateCourse,
  reactivateCourse,
  deleteCourse,
} from '../controllers/courseController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createCourseSchema, updateCourseSchema } from '../validators/schemas.js';
import { ROLES } from '../constants/index.js';

const router = Router();

router.use(authenticate);

router
  .route('/')
  .get(getCourses)
  .post(
    authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN),
    validate(createCourseSchema),
    createCourse
  );

router.get('/:id', getCourseById);
router.patch(
  '/:id',
  authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  validate(updateCourseSchema),
  updateCourse
);
router.post('/:id/deactivate', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), deactivateCourse);
router.post('/:id/reactivate', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), reactivateCourse);
router.delete('/:id', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), deleteCourse);

export default router;
