import mongoose from 'mongoose';
import { PERMISSION_SCOPES } from '../constants/permissions.js';

const rolePermissionSchema = new mongoose.Schema(
  {
    role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', required: true, index: true },
    permission: { type: mongoose.Schema.Types.ObjectId, ref: 'Permission', required: true, index: true },
    permissionKey: { type: String, required: true, index: true },
    scope: {
      type: String,
      enum: Object.values(PERMISSION_SCOPES),
      default: PERMISSION_SCOPES.OWN,
    },
  },
  { timestamps: true }
);

rolePermissionSchema.index({ role: 1, permission: 1 }, { unique: true });
rolePermissionSchema.index({ role: 1, permissionKey: 1 }, { unique: true });

const RolePermission = mongoose.model('RolePermission', rolePermissionSchema);
export default RolePermission;
