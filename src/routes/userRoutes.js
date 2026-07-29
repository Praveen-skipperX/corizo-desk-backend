import { Router } from 'express';
import {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deactivateUser,
  reactivateUser,
  deleteUser,
  unlockUserAccount,
  resetUserPassword,
  createDepartment,
  getDepartments,
  getDepartmentById,
  updateDepartment,
  deactivateDepartment,
  reactivateDepartment,
  deleteDepartment,
  getLockedAccounts,
} from '../controllers/userController.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createUserSchema,
  updateUserSchema,
  resetUserPasswordSchema,
  createDepartmentSchema,
  paginationSchema,
} from '../validators/schemas.js';
import { ROLES } from '../constants/index.js';

const router = Router();

router.use(authenticate);

router.get('/locked', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), getLockedAccounts);

router.route('/departments')
  .get(getDepartments)
  .post(authorize(ROLES.SUPER_ADMIN), validate(createDepartmentSchema), createDepartment);

router.patch('/departments/:id', authorize(ROLES.SUPER_ADMIN), updateDepartment);
router.get('/departments/:id', authorize(ROLES.SUPER_ADMIN), getDepartmentById);
router.post('/departments/:id/deactivate', authorize(ROLES.SUPER_ADMIN), deactivateDepartment);
router.post('/departments/:id/reactivate', authorize(ROLES.SUPER_ADMIN), reactivateDepartment);
router.delete('/departments/:id', authorize(ROLES.SUPER_ADMIN), deleteDepartment);

router.route('/')
  .get(validate(paginationSchema), getUsers)
  .post(
    authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN),
    validate(createUserSchema),
    createUser
  );

router.route('/:id')
  .get(getUserById)
  .patch(
    authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN),
    validate(updateUserSchema),
    updateUser
  )
  .delete(authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), deleteUser);

router.post('/:id/deactivate', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), deactivateUser);
router.post('/:id/reactivate', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), reactivateUser);
router.post('/:id/unlock', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), unlockUserAccount);
router.post(
  '/:id/reset-password',
  authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  validate(resetUserPasswordSchema),
  resetUserPassword
);

export default router;
