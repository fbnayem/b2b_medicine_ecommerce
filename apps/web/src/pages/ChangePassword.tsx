import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { landingRouteFor } from '@medsupply/navigation';
import type { UserRole } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { usePasswordPolicy } from '../lib/usePasswordPolicy';
import { Button, Card, ErrorState, Field, Input, PageHeader, toast } from '../components/ui';

/**
 * Choosing your own password.
 *
 * There was no way to do this anywhere in the product. `forcePasswordChange`
 * was set on account creation and on an administrative reset, returned at
 * sign-in, and rendered as a line of advisory text — checked by nothing, with
 * no endpoint that could have satisfied it. An administrator issuing a
 * "temporary" password was issuing a permanent one.
 */
export function ChangePassword() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const setAuth = useAuthStore((state) => state.setAuth);
  const accessToken = useAuthStore((state) => state.accessToken);
  const minimum = usePasswordPolicy();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const forced = Boolean(user?.forcePasswordChange);

  const tooShort = newPassword.length > 0 && newPassword.length < minimum;
  const mismatch = confirmation.length > 0 && confirmation !== newPassword;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword !== confirmation) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const response = await apiClient.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      const revoked = response.data?.data?.otherSessionsRevoked ?? 0;

      // The flag is cleared server-side; mirror it locally so the guard below
      // stops redirecting immediately rather than after the next request.
      if (user && accessToken) setAuth({ ...user, forcePasswordChange: false }, accessToken);

      toast.success(
        'Your password has been changed.',
        revoked > 0
          ? `You were signed out of ${revoked} other device${revoked === 1 ? '' : 's'}.`
          : undefined,
      );
      navigate(user ? landingRouteFor(user.role as UserRole) : '/dashboard', { replace: true });
    } catch (caught) {
      const failure = caught as { response?: { data?: { error?: { message?: string } } } };
      setError(failure.response?.data?.error?.message ?? 'Unable to change your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        routeId="change-password"
        title={forced ? 'Choose your own password' : 'Change your password'}
        description={
          forced
            ? 'Somebody set this password for you, so it is known to more than one person. ' +
              'Choose one only you know before you carry on.'
            : 'You will stay signed in here. Every other device will be signed out.'
        }
      />

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <ErrorState title="That did not work" message={error} />}

          <Field label="Your current password" required>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>

          <Field
            label="New password"
            required
            hint={`At least ${minimum} characters.`}
            error={tooShort ? `Use at least ${minimum} characters.` : undefined}
          >
            <Input
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>

          <Field
            label="New password again"
            required
            error={mismatch ? 'These do not match.' : undefined}
          >
            <Input
              type="password"
              autoComplete="new-password"
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={tooShort || mismatch || !currentPassword || !newPassword}
          >
            Change password
          </Button>
        </form>
      </Card>
    </div>
  );
}
