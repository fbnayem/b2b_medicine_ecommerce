import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UserRole } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Resource,
  toast,
  useAsk,
  type Column,
} from '../components/ui';
import { useApiCollection, useApiResource } from '../lib/query';
import { keys } from '../lib/queryKeys';
import { useLanguage } from '../lib/useLanguage';
import { formatFinanceDate } from '../lib/finance';
import { deviceLabel, endedLabel, formatUptime } from './securityLabels';

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
  tokens: { accessTokenMinutes: number; refreshTokenDays: number; dedicatedRefreshSecret: boolean };
  request: { trustProxyHops: number; jsonBodyLimit: string; uploadBodyLimit: string };
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 last:border-b-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-text">{value}</dd>
    </div>
  );
}

export function SecurityCentre() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);
  const [busyId, setBusyId] = useState('');

  const isAdministrator =
    currentUser?.role === UserRole.SUPER_ADMIN || currentUser?.role === UserRole.ADMIN;

  const sessions = useApiCollection<SessionRow>(keys.security.sessions(), '/auth/sessions');
  const runtime = useApiResource<RuntimeStatus>(keys.security.runtime(), '/admin/runtime', {
    // Supplementary. Failing to read it must not hide the session list, which
    // is the part every role depends on.
    enabled: isAdministrator,
    retry: false,
  });

  const reload = () => queryClient.invalidateQueries({ queryKey: keys.security.all });

  async function revoke(session: SessionRow) {
    /*
     * `window.confirm` again, on the one screen where signing yourself out is a
     * click away from signing out the device you are reading this on. Playwright
     * and jsdom both dismiss the native dialog silently, so a test could have
     * claimed to cover this while cancelling it.
     */
    const agreed = await ask.confirm({
      title: session.current ? t('security.signOutThisTitle') : t('security.signOutOtherTitle'),
      description: session.current ? t('security.signOutThisBody') : t('security.signOutOtherBody'),
      confirmLabel: t('security.signOut'),
      danger: true,
    });
    if (!agreed) return;

    setBusyId(session._id);
    try {
      await apiClient.delete(`/auth/sessions/${session._id}`);
      await reload();
      toast.success(session.current ? t('security.signedOutThis') : t('security.signedOutOther'));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('security.signOutFailed')));
    } finally {
      setBusyId('');
    }
  }

  async function revokeAll() {
    const agreed = await ask.confirm({
      title: t('security.signOutAllTitle'),
      description: t('security.signOutAllBody'),
      confirmLabel: t('security.signOutEverywhere'),
      danger: true,
    });
    if (!agreed) return;

    setBusyId('all');
    try {
      const response = await apiClient.post('/auth/logout-all');
      await reload();
      toast.success(
        t('security.signedOutAll', { count: (response.data.data.revoked as number) ?? 0 }),
      );
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('security.signOutFailed')));
    } finally {
      setBusyId('');
    }
  }

  const columns: ReadonlyArray<Column<SessionRow>> = [
    {
      key: 'device',
      header: t('security.device'),
      cell: (session) => (
        <div>
          <p className="text-text">{deviceLabel(t, session.userAgent)}</p>
          {session.current && <p className="text-sm text-text-muted">{t('security.thisDevice')}</p>}
        </div>
      ),
    },
    { key: 'ip', header: t('security.ipAddress'), cell: (session) => session.ipAddress ?? '—' },
    {
      key: 'created',
      header: t('security.signedIn'),
      cell: (session) => formatFinanceDate(session.createdAt),
    },
    {
      key: 'used',
      header: t('security.lastUsed'),
      cell: (session) => (session.lastUsedAt ? formatFinanceDate(session.lastUsedAt) : '—'),
    },
    {
      key: 'state',
      header: t('security.state'),
      cell: (session) =>
        session.revokedAt ? (
          <Badge tone="danger">{endedLabel(t, session.revokedReason)}</Badge>
        ) : (
          <Badge tone="success">{t('security.active')}</Badge>
        ),
    },
    {
      key: 'action',
      header: '',
      label: '',
      cell: (session) =>
        session.revokedAt ? (
          '—'
        ) : (
          <Button
            size="sm"
            busy={busyId === session._id}
            disabled={busyId !== ''}
            onClick={() => void revoke(session)}
          >
            {t('security.signOut')}
          </Button>
        ),
    },
  ];

  const active = (sessions.data?.items ?? []).filter((session) => !session.revokedAt);

  return (
    <>
      <PageHeader
        routeId="security"
        title={t('security.title')}
        description={t('security.subtitle')}
        actions={
          active.length > 1 && (
            <Button
              busy={busyId === 'all'}
              disabled={busyId !== ''}
              onClick={() => void revokeAll()}
            >
              {t('security.signOutEverywhere')}
            </Button>
          )
        }
      />

      <Resource
        query={sessions}
        loadingLabel={t('security.loading')}
        errorMessageFallback={t('security.couldNotLoad')}
        empty={<EmptyState title={t('security.none')} description={t('security.noneBody')} />}
      >
        {(page) => (
          <Card className="mb-4">
            <h2 className="mb-2 text-lg font-semibold text-text">{t('security.whereSignedIn')}</h2>
            <DataTable
              caption={t('security.whereSignedIn')}
              columns={columns}
              rows={page.items}
              rowKey={(session) => session._id}
            />
            <p className="mt-3 max-w-prose text-sm text-text-muted">{t('security.immediate')}</p>
          </Card>
        )}
      </Resource>

      {isAdministrator &&
        (runtime.data ? (
          <Card>
            <h2 className="mb-1 text-lg font-semibold text-text">{t('security.deployment')}</h2>
            <p className="mb-3 max-w-prose text-text-muted">{t('security.deploymentBody')}</p>
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              <dl className="m-0">
                <Stat
                  label={t('security.version')}
                  value={`${runtime.data.version} (${runtime.data.commit.slice(0, 12)})`}
                />
                <Stat label={t('security.environment')} value={runtime.data.environment} />
                <Stat
                  label={t('security.uptime')}
                  value={formatUptime(runtime.data.uptimeSeconds)}
                />
                <Stat
                  label={t('security.database')}
                  value={`${runtime.data.database.state} · ${t('security.pool', {
                    size: runtime.data.database.maxPoolSize,
                  })}`}
                />
              </dl>
              <dl className="m-0">
                <Stat
                  label={t('security.rateLimiting')}
                  value={`${
                    runtime.data.rateLimit.driver === 'redis'
                      ? t('security.shared')
                      : t('security.perInstance')
                  } · ${t('security.window', { seconds: runtime.data.rateLimit.windowSeconds })}`}
                />
                <Stat
                  label={t('security.signInBudget')}
                  value={t('security.perWindow', { count: runtime.data.rateLimit.auth })}
                />
                <Stat
                  label={t('security.writeBudget')}
                  value={t('security.perWindow', { count: runtime.data.rateLimit.write })}
                />
                <Stat
                  label={t('security.reportBudget')}
                  value={t('security.perWindow', { count: runtime.data.rateLimit.report })}
                />
              </dl>
              <dl className="m-0">
                <Stat
                  label={t('security.accessToken')}
                  value={t('security.minutes', { count: runtime.data.tokens.accessTokenMinutes })}
                />
                <Stat
                  label={t('security.refreshToken')}
                  value={t('security.days', { count: runtime.data.tokens.refreshTokenDays })}
                />
                <Stat
                  label={t('security.separateSecret')}
                  value={
                    runtime.data.tokens.dedicatedRefreshSecret
                      ? t('catalogue.yes')
                      : t('security.derived')
                  }
                />
                <Stat
                  label={t('security.trustedProxies')}
                  value={runtime.data.request.trustProxyHops}
                />
              </dl>
              <dl className="m-0">
                <Stat label={t('security.realtime')} value={runtime.data.realtime.driver} />
                <Stat
                  label={t('security.notificationQueue')}
                  value={runtime.data.notifications.driver}
                />
                <Stat label={t('security.bodyLimit')} value={runtime.data.request.jsonBodyLimit} />
                <Stat
                  label={t('security.uploadLimit')}
                  value={runtime.data.request.uploadBodyLimit}
                />
              </dl>
            </div>
          </Card>
        ) : (
          runtime.isError && (
            <p className="text-text-muted">{t('security.deploymentUnavailable')}</p>
          )
        ))}
    </>
  );
}
