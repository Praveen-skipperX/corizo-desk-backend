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
import { authenticate, authorize, requirePermission } from '../middleware/auth.js';
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

router.patch('/departments/:id', authorize(ROLES.SUPER_ADMIN), requirePermission('departments.edit'), updateDepartment);
router.get('/departments/:id', authorize(ROLES.SUPER_ADMIN), getDepartmentById);
router.post('/departments/:id/deactivate', authorize(ROLES.SUPER_ADMIN), deactivateDepartment);
router.post('/departments/:id/reactivate', authorize(ROLES.SUPER_ADMIN), reactivateDepartment);
router.delete('/departments/:id', authorize(ROLES.SUPER_ADMIN), requirePermission('departments.delete'), deleteDepartment);

router.route('/')
  .get(validate(paginationSchema), getUsers)
  .post(
    authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN),
    requirePermission('users.create'),
    validate(createUserSchema),
    createUser
  );

router.route('/:id')
  .get(getUserById)
  .patch(
    authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN),
    requirePermission('users.edit'),
    validate(updateUserSchema),
    updateUser
  )
  .delete(authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), requirePermission('users.delete'), deleteUser);

router.post('/:id/deactivate', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), requirePermission('users.delete'), deactivateUser);
router.post('/:id/reactivate', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), requirePermission('users.edit'), reactivateUser);
router.post('/:id/unlock', authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN), requirePermission('users.unlock'), unlockUserAccount);
router.post(
  '/:id/reset-password',
  authorize(ROLES.SUPER_ADMIN, ROLES.ADMIN),
  requirePermission('users.reset_password'), validate(resetUserPasswordSchema),
  resetUserPassword
);

export default router;
