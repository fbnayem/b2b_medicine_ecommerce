import { useCallback, useEffect, useState } from 'react';
import { UserRole } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { formatFinanceDate } from '../lib/finance';
import { describeDevice, formatUptime, revocationLabel } from './securityLabels';
import './inventory.css';

export interface SessionRow {
  _id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  current: boolean;
}

interface RuntimeStatus {
  version: string;
  commit: string;
  environment: string;
  uptimeSeconds: number;
  database: { state: string; maxPoolSize: number; queryTimeoutMs: number };
  realtime: { driver: string };
  notifications: { driver: string };
  rateLimit: {
    driver: string;
    windowSeconds: number;
    global: number;
    auth: number;
    write: number;
    report: number;
  };
  tokens: {
    accessTokenMinutes: number;
    refreshTokenDays: number;
    dedicatedRefreshSecret: boolean;
  };
  request: { trustProxyHops: number; jsonBodyLimit: string; uploadBodyLimit: string };
}

function failureMessage(caught: unknown, fallback: string) {
  const failure = caught as { response?: { data?: { error?: { message?: string } } } };
  return failure.response?.data?.error?.message ?? fallback;
}

export function SecurityCentre() {
  const currentUser = useAuthStore((state) => state.user);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busyId, setBusyId] = useState('');

  const isAdministrator =
    currentUser?.role === UserRole.SUPER_ADMIN || currentUser?.role === UserRole.ADMIN;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/auth/sessions');
      setSessions(Array.isArray(response.data.data) ? response.data.data : []);
      setError('');
    } catch (caught) {
      setError(failureMessage(caught, 'Unable to load your sign-ins.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRuntime = useCallback(async () => {
    if (!isAdministrator) return;
    try {
      const response = await apiClient.get('/admin/runtime');
      setRuntime(response.data.data as RuntimeStatus);
    } catch {
      // The deployment panel is supplementary. Failing to read it must not hide
      // the session list, which is the part every role depends on.
      setRuntime(null);
    }
  }, [isAdministrator]);

  useEffect(() => {
    void load();
    void loadRuntime();
  }, [load, loadRuntime]);

  async function revoke(session: SessionRow) {
    const question = session.current
      ? 'Sign out of this device? You will need to sign in again.'
      : 'Sign out of that device?';
    if (!globalThis.confirm(question)) return;
    setBusyId(session._id);
    try {
      await apiClient.delete(`/auth/sessions/${session._id}`);
      setFeedback(session.current ? 'This device was signed out.' : 'That device was signed out.');
      await load();
    } catch (caught) {
      setError(failureMessage(caught, 'Unable to sign that device out.'));
    } finally {
      setBusyId('');
    }
  }

  async function revokeAll() {
    if (!globalThis.confirm('Sign out of every device, including this one?')) return;
    setBusyId('all');
    try {
      const response = await apiClient.post('/auth/logout-all');
      setFeedback(`Signed out of ${response.data.data.revoked ?? 0} device(s).`);
      await load();
    } catch (caught) {
      setError(failureMessage(caught, 'Unable to sign out everywhere.'));
    } finally {
      setBusyId('');
    }
  }

  const active = sessions.filter((session) => !session.revokedAt);

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Account security</p>
          <h1>Security centre</h1>
          <p>
            Every device signed in to your account. Sign one out if you do not recognise it, or if
            you have lost it.
          </p>
        </div>
        {active.length > 1 ? (
          <button
            className="secondary-button"
            disabled={busyId !== ''}
            onClick={() => void revokeAll()}
          >
            {busyId === 'all' ? 'Signing out...' : 'Sign out everywhere'}
          </button>
        ) : null}
      </header>

      {error ? (
        <section className="state error" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}

      {feedback ? (
        <section className="state success" role="status">
          {feedback}
        </section>
      ) : null}

      {loading ? (
        <section className="state">Loading your sign-ins...</section>
      ) : sessions.length === 0 ? (
        <section className="state">There are no recorded sign-ins for this account.</section>
      ) : (
        <section className="panel">
          <h2>Where you are signed in</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Address</th>
                  <th>Signed in</th>
                  <th>Last used</th>
                  <th>State</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session._id}>
                    <td>
                      {describeDevice(session.userAgent)}
                      {session.current ? <small>This device</small> : null}
                    </td>
                    <td>{session.ipAddress ?? '—'}</td>
                    <td>{formatFinanceDate(session.createdAt)}</td>
                    <td>{session.lastUsedAt ? formatFinanceDate(session.lastUsedAt) : '—'}</td>
                    <td>
                      {session.revokedAt ? (
                        <span className="return-status rejected">
                          {revocationLabel(session.revokedReason)}
                        </span>
                      ) : (
                        <span className="return-status approved">Active</span>
                      )}
                    </td>
                    <td>
                      {session.revokedAt ? (
                        '—'
                      ) : (
                        <button
                          className="link-button"
                          disabled={busyId !== ''}
                          onClick={() => void revoke(session)}
                        >
                          {busyId === session._id ? 'Signing out...' : 'Sign out'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Signing a device out takes effect immediately: its access token stops working on the
            next request rather than at the end of its lifetime.
          </p>
        </section>
      )}

      {isAdministrator ? (
        runtime ? (
          <section className="panel">
            <h2>Deployment</h2>
            <p className="muted">
              What this instance is running and how its protections are configured. Read-only, and
              no secret is shown — only whether one is set.
            </p>
            <div className="analytics-columns">
              <dl className="stat-list">
                <div>
                  <dt>Version</dt>
                  <dd>
                    {runtime.version} ({runtime.commit.slice(0, 12)})
                  </dd>
                </div>
                <div>
                  <dt>Environment</dt>
                  <dd>{runtime.environment}</dd>
                </div>
                <div>
                  <dt>Uptime</dt>
                  <dd>{formatUptime(runtime.uptimeSeconds)}</dd>
                </div>
                <div>
                  <dt>Database</dt>
                  <dd>
                    {runtime.database.state} · pool {runtime.database.maxPoolSize}
                  </dd>
                </div>
              </dl>
              <dl className="stat-list">
                <div>
                  <dt>Rate limiting</dt>
                  <dd>
                    {runtime.rateLimit.driver === 'redis' ? 'shared' : 'per instance'} ·{' '}
                    {runtime.rateLimit.windowSeconds}s window
                  </dd>
                </div>
                <div>
                  <dt>Sign-in budget</dt>
                  <dd>{runtime.rateLimit.auth} per window</dd>
                </div>
                <div>
                  <dt>Write budget</dt>
                  <dd>{runtime.rateLimit.write} per window</dd>
                </div>
                <div>
                  <dt>Report budget</dt>
                  <dd>{runtime.rateLimit.report} per window</dd>
                </div>
              </dl>
              <dl className="stat-list">
                <div>
                  <dt>Access token</dt>
                  <dd>{runtime.tokens.accessTokenMinutes} minutes</dd>
                </div>
                <div>
                  <dt>Refresh token</dt>
                  <dd>{runtime.tokens.refreshTokenDays} days</dd>
                </div>
                <div>
                  <dt>Separate refresh secret</dt>
                  <dd>
                    {runtime.tokens.dedicatedRefreshSecret ? 'Yes' : 'Derived from JWT secret'}
                  </dd>
                </div>
                <div>
                  <dt>Trusted proxies</dt>
                  <dd>{runtime.request.trustProxyHops}</dd>
                </div>
              </dl>
              <dl className="stat-list">
                <div>
                  <dt>Realtime</dt>
                  <dd>{runtime.realtime.driver}</dd>
                </div>
                <div>
                  <dt>Notification queue</dt>
                  <dd>{runtime.notifications.driver}</dd>
                </div>
                <div>
                  <dt>Request body limit</dt>
                  <dd>{runtime.request.jsonBodyLimit}</dd>
                </div>
                <div>
                  <dt>Upload body limit</dt>
                  <dd>{runtime.request.uploadBodyLimit}</dd>
                </div>
              </dl>
            </div>
          </section>
        ) : (
          <section className="state">
            The deployment status could not be read. Your sign-ins above are unaffected.
          </section>
        )
      ) : null}
    </main>
  );
}
