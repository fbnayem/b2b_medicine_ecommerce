import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { User } from '../src/models/User';
import { env } from '../src/env';
import { UserRole, UserStatus } from '@medsupply/shared-types';
import { securitySettings } from '../src/services/settingsService';

/**
 * Creates the first Super Admin so somebody can sign in and create everyone
 * else. It is the only account this system ever creates without an actor.
 *
 * It used to hard-code `SuperSecurePassword123!`, print it, and leave
 * `forcePasswordChange` off — so any deployment that ran it had a Super Admin
 * whose password is published in this repository, valid indefinitely. The
 * credential is now supplied by whoever runs the script, never echoed, and must
 * be changed at first sign-in.
 *
 *   BOOTSTRAP_EMAIL=admin@example.com \
 *   BOOTSTRAP_PASSWORD='<generated>' \
 *   node dist-scripts/scripts/bootstrap.js
 */
const bootstrap = async () => {
  const email = (process.env.BOOTSTRAP_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_PASSWORD ?? '';

  if (!email || !password) {
    console.error(
      'BOOTSTRAP_EMAIL and BOOTSTRAP_PASSWORD must both be set.\n' +
        'Generate a password with:\n' +
        "  node -e \"console.log(require('node:crypto').randomBytes(18).toString('base64url'))\"",
    );
    process.exit(1);
  }

  try {
    await mongoose.connect(env.MONGODB_URI);

    // The minimum length is policy, from System Settings, so the first account
    // is held to the same standard as every account created after it.
    const policy = await securitySettings();
    if (password.length < policy.passwordMinLength) {
      console.error(`BOOTSTRAP_PASSWORD must be at least ${policy.passwordMinLength} characters.`);
      await mongoose.disconnect();
      process.exit(1);
    }

    // Rerunnable: an existing Super Admin is never overwritten, because doing
    // so would be a silent takeover of the highest-privilege account.
    const existing = await User.findOne({ email }).select('_id');
    if (existing) {
      console.log(`A user already exists for ${email}. Nothing was changed.`);
      await mongoose.disconnect();
      process.exit(0);
    }

    const anySuperAdmin = await User.exists({ role: UserRole.SUPER_ADMIN });
    if (anySuperAdmin) {
      console.log(
        'A Super Admin already exists. Create further accounts through the ' +
          'application so the change is attributed and audited.',
      );
      await mongoose.disconnect();
      process.exit(0);
    }

    await User.create({
      email,
      passwordHash: await bcrypt.hash(password, 12),
      firstName: process.env.BOOTSTRAP_FIRST_NAME?.trim() || 'System',
      lastName: process.env.BOOTSTRAP_LAST_NAME?.trim() || 'Administrator',
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      // The password reached this process through an environment variable and
      // may survive in a shell history or a process listing, so it is treated
      // as compromised from the moment it is used.
      forcePasswordChange: true,
    });

    // The address is echoed so the operator can confirm it; the password never
    // is, and neither is any hash.
    console.log(`Super Admin created for ${email}.`);
    console.log('Sign in with the password you supplied; you will be asked to change it.');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Bootstrap failed:', (error as Error).message);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
};

bootstrap();
