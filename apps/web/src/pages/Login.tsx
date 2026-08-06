import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuth';
import { apiClient, errorMessage, failureReference } from '../api/client';
import { landingRouteFor } from '../app/landing';
import { Button, Card, ErrorState, Field, Input, PageHeader } from '../components/ui';
import { useLanguage } from '../lib/useLanguage';

export function Login() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { setAuth, isAuthenticated, user } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  // Now that a session survives a reload, someone who is already signed in can
  // land here from a bookmark. Showing them the form would invite them to
  // re-authenticate for no reason.
  if (isAuthenticated && user) {
    return <Navigate to={landingRouteFor(user.role)} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setSubmitting(true);
    try {
      const response = await apiClient.post('/auth/login', { email, password });
      const { user: signedIn, accessToken } = response.data.data;
      setAuth(signedIn, accessToken);
      navigate(landingRouteFor(signedIn.role));
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('auth.signInFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <PageHeader routeId="login" title={t('common.appName')} description={t('auth.signInTitle')} />
      <Card>
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          {/*
            An error state, not a coloured box. A refusal that is only visible
            is a refusal a screen-reader user does not receive — and on this
            screen the alternative reading is "my password was accepted and
            nothing happened", which is exactly how the shop-owner routing
            defect presented.
          */}
          {failure && <ErrorState message={failure.message} reference={failure.reference} />}

          <Field label={t('auth.email')} required hint={t('hints.loginEmail')}>
            <Input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field label={t('auth.password')} required hint={t('hints.loginPassword')}>
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Button type="submit" variant="primary" busy={submitting}>
            {submitting ? t('auth.signingIn') : t('common.signIn')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
