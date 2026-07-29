import crypto from 'crypto';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import speakeasy from 'speakeasy';
import config from '../src/config/index.js';
import { User, Department, Course, AuthenticatorConfig } from '../src/models/index.js';
import { ROLES } from '../src/constants/index.js';
import { CORIZO_COURSES, courseCodeFromName } from '../src/constants/courses.js';
import { seedRbac } from '../src/services/permissionService.js';

dotenv.config();

/** Stable bootstrap identity — stored in MongoDB only; not read from .env for auth. */
const BOOTSTRAP_SUPER_ADMIN = {
  name: 'Super Admin',
  email: 'superadmin@corizo.in',
  username: 'superadmin',
};

const departments = [
  { name: 'Sales', code: 'SALES', description: 'Sales and business development' },
  { name: 'IT', code: 'IT', description: 'Information Technology' },
  { name: 'Marketing', code: 'MKT', description: 'Marketing and campaigns' },
  { name: 'Support', code: 'SUP', description: 'Customer support' },
  { name: 'Finance', code: 'FIN', description: 'Finance and accounting' },
  { name: 'HR', code: 'HR', description: 'Human Resources' },
];

const generateTemporaryPassword = () => {
  const raw = crypto.randomBytes(18).toString('base64url');
  // Ensure complexity for password policy (upper, lower, digit, symbol)
  return `Cd!${raw.slice(0, 12)}9A`;
};

const seed = async () => {
  const resetPassword = process.argv.includes('--reset-password');

  try {
    if (!config.mongodbUri) {
      throw new Error('MONGODB_URI is required');
    }

    await mongoose.connect(config.mongodbUri);
    console.log('Connected to MongoDB');

    for (const dept of departments) {
      await Department.findOneAndUpdate({ code: dept.code }, dept, { upsert: true, new: true });
      console.log(`Department seeded: ${dept.name}`);
    }

    for (const course of CORIZO_COURSES) {
      const code = courseCodeFromName(course.name);
      await Course.findOneAndUpdate(
        { code },
        {
          name: course.name,
          code,
          category: course.category,
          sortOrder: course.sortOrder,
          isActive: true,
          deletedAt: null,
        },
        { upsert: true, new: true }
      );
      console.log(`Course seeded: ${course.name}`);
    }

    const rbac = await seedRbac();
    console.log('RBAC seeded:', rbac);

    let superAdmin = await User.findOne({ role: ROLES.SUPER_ADMIN }).select('+password');
    let temporaryPassword = null;
    let created = false;

    if (!superAdmin) {
      temporaryPassword = generateTemporaryPassword();
      superAdmin = await User.create({
        name: BOOTSTRAP_SUPER_ADMIN.name,
        email: BOOTSTRAP_SUPER_ADMIN.email,
        username: BOOTSTRAP_SUPER_ADMIN.username,
        password: temporaryPassword, // hashed by User pre-save hook
        role: ROLES.SUPER_ADMIN,
        isActive: true,
        isLocked: false,
        mustChangePassword: true,
        mustSetPasswordOnFirstLogin: false,
      });

      const secret = speakeasy.generateSecret({
        name: `Corizo Desk (${BOOTSTRAP_SUPER_ADMIN.username})`,
      });

      await AuthenticatorConfig.create({
        user: superAdmin._id,
        secret: secret.base32,
        isEnabled: false,
      });

      created = true;

      console.log('\n========================================');
      console.log('Super Admin CREATED in MongoDB');
      console.log('========================================');
      console.log(`Username: ${BOOTSTRAP_SUPER_ADMIN.username}`);
      console.log(`Email:    ${BOOTSTRAP_SUPER_ADMIN.email}`);
      console.log(`Temp password: ${temporaryPassword}`);
      console.log('\nYou will be asked to set up TOTP on first login.');
      console.log('Change the password after first successful login.');
      console.log('TOTP secret (backup):', secret.base32);
      console.log(secret.otpauth_url);
      console.log('========================================\n');
    } else if (resetPassword) {
      temporaryPassword = generateTemporaryPassword();
      superAdmin.password = temporaryPassword;
      superAdmin.isLocked = false;
      superAdmin.isActive = true;
      superAdmin.mustChangePassword = true;
      // Keep existing email/username in DB — do not overwrite from .env
      await superAdmin.save();

      console.log('\n========================================');
      console.log('Super Admin password RESET (MongoDB)');
      console.log('========================================');
      console.log(`Username: ${superAdmin.username}`);
      console.log(`Email:    ${superAdmin.email}`);
      console.log(`Temp password: ${temporaryPassword}`);
      console.log('Change the password after login.');
      console.log('========================================\n');
    } else {
      console.log('\nSuper Admin already exists in MongoDB (no password change).');
      console.log(`Username: ${superAdmin.username}`);
      console.log(`Email:    ${superAdmin.email}`);
      console.log('To rotate the password, run: npm run seed -- --reset-password\n');
    }

    // Write credentials file only when a temp password was issued (gitignored via *.local)
    if (temporaryPassword) {
      const { writeFile } = await import('fs/promises');
      const { join, dirname } = await import('path');
      const { fileURLToPath } = await import('url');
      const dir = dirname(fileURLToPath(import.meta.url));
      const out = join(dir, 'superadmin-credentials.local.txt');
      await writeFile(
        out,
        [
          'Corizo Desk — Super Admin temporary credentials',
          `Created/reset at: ${new Date().toISOString()}`,
          `Username: ${superAdmin.username}`,
          `Email: ${superAdmin.email}`,
          `Temporary password: ${temporaryPassword}`,
          'Login: /super-admin/login',
          'Delete this file after saving the password securely.',
          '',
        ].join('\n'),
        'utf8'
      );
      console.log(`Credentials also written to scripts/superadmin-credentials.local.txt`);
    }

    console.log(created ? 'Seed complete (new Super Admin).' : 'Seed complete.');
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
};

seed();
