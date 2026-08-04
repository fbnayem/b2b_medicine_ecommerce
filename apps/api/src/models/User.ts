import mongoose from 'mongoose';
import { UserRole, UserStatus } from '@medsupply/shared-types';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    /** Optional contact number used by the SMS and WhatsApp notification channels. */
    phone: { type: String, trim: true },
    role: {
      type: String,
      enum: Object.values(UserRole),
      required: true,
    },
    /**
     * The areas a sales representative carries, matched against `Shop.territory`.
     *
     * Empty means every territory, which is what every existing user has and
     * what management needs. A rep with territories set can place an order only
     * for a shop in one of them — checked in the service, not on the screen,
     * because a filter a client applies is a filter a client can drop.
     */
    territories: { type: [String], default: [] },
    status: {
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.ACTIVE,
    },
    loginAttempts: { type: Number, default: 0 },
    lockoutUntil: { type: Date },
    forcePasswordChange: { type: Boolean, default: false },
    lastLogin: { type: Date },
  },
  { timestamps: true },
);

/**
 * The password hash never leaves the process.
 *
 * Sign-in has to load the whole document to compare the password, and it then
 * returned that document to the caller — so every successful login handed the
 * account's bcrypt hash to the client. Callers that remembered to project it
 * away were safe and one that forgot was not, which is the wrong way round.
 * Removing it at serialisation makes the safe outcome the default, and the
 * lockout counters go with it because they tell an attacker how many attempts
 * remain.
 */
function stripSensitive(_doc: unknown, ret: Record<string, unknown>) {
  delete ret.passwordHash;
  delete ret.loginAttempts;
  delete ret.lockoutUntil;
  delete ret.__v;
  return ret;
}

userSchema.set('toJSON', { transform: stripSensitive });
userSchema.set('toObject', { transform: stripSensitive });

// Sign-in looks an account up by email on every attempt, and the directory
// sorts by name; both are indexed rather than scanned.
userSchema.index({ role: 1, status: 1 });
userSchema.index({ lastName: 1, firstName: 1 });

export const User = mongoose.model('User', userSchema);
