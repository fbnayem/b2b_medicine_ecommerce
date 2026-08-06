import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { landingRouteFor } from '@medsupply/navigation';
import type { UserRole } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { usePasswordPolicy } from '../lib/usePasswordPolicy';
import { Button, Card, ErrorState, Field, Input, PageHeader, toast } from '../components/ui';
import { errorMessage } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../lib/useLanguage';
import { keys } from '../lib/queryKeys';

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
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
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
      setError(t('auth.passwordsDoNotMatch'));
      return;
    }
    setBusy(true);
    try {
      const response = await apiClient.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      queryClient.invalidateQueries({ queryKey: keys.security.all });
      const revoked = response.data?.data?.otherSessionsRevoked ?? 0;

      // The flag is cleared server-side; mirror it locally so the guard below
      // stops redirecting immediately rather than after the next request.
      if (user && accessToken) setAuth({ ...user, forcePasswordChange: false }, accessToken);

      toast.success(
        t('auth.changed'),
        revoked > 0
          ? revoked === 1
            ? t('auth.oneOtherSignedOut')
            : t('auth.otherSignedOut', { count: revoked })
          : undefined,
      );
      navigate(user ? landingRouteFor(user.role as UserRole) : '/dashboard', { replace: true });
    } catch (caught) {
      setError(errorMessage(caught, language, t('auth.changeFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        routeId="change-password"
        title={forced ? t('auth.mustChangeTitle') : t('auth.changeOwnTitle')}
        description={forced ? t('auth.mustChangeBody') : t('auth.changeOwnBody')}
      />

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <ErrorState title={t('auth.thatDidNotWork')} message={error} />}

          <Field label={t('auth.currentPassword')} required hint={t('hints.currentPassword')}>
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>

          <Field
            label={t('auth.newPassword')}
            required
            hint={t('auth.atLeast', { minimum })}
            error={tooShort ? t('auth.passwordTooShort', { minimum }) : undefined}
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
            label={t('auth.repeatPassword')}
            required
            error={mismatch ? t('auth.passwordsDoNotMatch') : undefined}
            hint={t('hints.repeatPassword')}
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
            {t('auth.changeButton')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
