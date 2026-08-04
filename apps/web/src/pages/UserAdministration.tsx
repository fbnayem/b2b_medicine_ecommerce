import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UserRole, UserStatus, type User } from '@medsupply/shared-types';
import { apiClient, errorMessage } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Resource,
  Select,
  StatusPill,
  requireReason,
  toast,
  useAsk,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { usePasswordPolicy } from '../lib/usePasswordPolicy';
import { formatFinanceDateTime } from '../lib/finance';

interface DirectoryUser extends User {
  activeSessions?: number;
}

const PAGE_SIZE = 20;

export function UserAdministration() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);
  // Read from System Settings rather than hard-coded, so an administrator is
  // held to the same minimum the server will enforce a moment later.
  const passwordMinLength = usePasswordPolicy();

  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState('');

  const canAdminister =
    currentUser?.role === UserRole.SUPER_ADMIN || currentUser?.role === UserRole.ADMIN;

  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (role) params.set('role', role);
  if (status) params.set('status', status);
  if (query) params.set('q', query);

  const users = useApiCollection<DirectoryUser>(
    ['admin-users', role, status, query, page],
    `/admin/users?${params.toString()}`,
  );

  const reload = () => queryClient.invalidateQueries({ queryKey: ['admin-users'] });

  async function patch(user: DirectoryUser, changes: Record<string, unknown>, done: string) {
    setBusyId(user._id);
    try {
      await apiClient.patch(`/admin/users/${user._id}`, changes);
      await reload();
      toast.success(done);
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('users.updateFailed')));
    } finally {
      setBusyId('');
    }
  }

  async function resetPassword(user: DirectoryUser) {
    /*
     * This was two `window.prompt` calls, the first of which took a password in
     * clear text — no masking, no validation against the configured minimum —
     * and the resulting credential was permanent, because nothing enforced
     * `forcePasswordChange` and no endpoint existed to satisfy it. Both halves
     * are fixed; this is the half the administrator sees.
     */
    const temporaryPassword = await ask.prompt({
      title: t('users.resetTitle', { name: `${user.firstName} ${user.lastName}` }),
      description: t('users.resetBody'),
      label: t('users.temporaryPassword'),
      hint: t('users.temporaryPasswordHint', { minimum: passwordMinLength }),
      type: 'password',
      confirmLabel: t('users.resetPassword'),
      danger: true,
      validate: (value) =>
        value.length < passwordMinLength
          ? t('users.tooShort', { minimum: passwordMinLength })
          : null,
    });
    if (!temporaryPassword) return;

    const reason = await ask.prompt({
      title: t('users.resetWhyTitle'),
      description: t('users.resetWhyBody'),
      label: t('actions.reason'),
      multiline: true,
      confirmLabel: t('users.resetPassword'),
      danger: true,
      validate: requireReason(),
    });
    if (!reason) return;

    setBusyId(user._id);
    try {
      await apiClient.post(`/admin/users/${user._id}/reset-password`, {
        temporaryPassword,
        reason,
      });
      await reload();
      toast.success(t('users.resetDone', { email: user.email }));
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('users.resetFailed')));
    } finally {
      setBusyId('');
    }
  }

  async function revokeSessions(user: DirectoryUser) {
    const reason = await ask.prompt({
      title: t('users.signOutTitle', { email: user.email }),
      description: t('users.signOutBody'),
      label: t('actions.reason'),
      multiline: true,
      confirmLabel: t('users.signOutConfirm'),
      danger: true,
      validate: requireReason(),
    });
    if (!reason) return;

    setBusyId(user._id);
    try {
      const response = await apiClient.post(`/admin/users/${user._id}/revoke-sessions`, { reason });
      await reload();
      toast.success(
        t('users.signOutDone', {
          count: response.data.data.revoked as number,
          email: user.email,
        }),
      );
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('users.signOutFailed')));
    } finally {
      setBusyId('');
    }
  }

  return (
    <main>
      <PageHeader
        routeId="users"
        title={t('users.title')}
        description={t('users.subtitle')}
        actions={<Button onClick={() => void users.refetch()}>{t('users.reload')}</Button>}
      />

      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setQuery(search.trim());
        }}
      >
        <Field label={t('users.searchLabel')} className="min-w-64 flex-1">
          <Input
            value={search}
            placeholder={t('users.searchPlaceholder')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field label={t('users.roleFilter')} className="min-w-48">
          <Select
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('users.anyRole')}</option>
            {Object.values(UserRole).map((value) => (
              <option key={value} value={value}>
                {t(`roles.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('users.statusFilter')} className="min-w-44">
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('users.anyStatus')}</option>
            {Object.values(UserStatus).map((value) => (
              <option key={value} value={value}>
                {value.toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit">{t('common.search')}</Button>
      </form>

      <Resource
        query={users}
        loadingLabel={t('users.loading')}
        errorMessageFallback={t('users.couldNotLoad')}
        empty={<EmptyState title={t('users.none')} description={t('users.noneBody')} />}
      >
        {(result) => (
          <>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {result.items.map((user) => {
                const isSelf = user._id === currentUser?._id;
                const busy = busyId === user._id;
                return (
                  <li key={user._id}>
                    <Card
                      data-test={`row-${user.email}`}
                      className="flex flex-wrap items-start justify-between gap-4"
                    >
                      <div className="min-w-64 flex-1">
                        <p className="font-medium text-text">
                          {user.firstName} {user.lastName}
                          {isSelf ? ` (${t('users.you')})` : ''}
                        </p>
                        <p className="text-text-muted">{user.email}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
                          <StatusPill kind="user" status={user.status} />
                          {t(`roles.${user.role}`)}
                          {user.forcePasswordChange ? ` · ${t('users.passwordChangePending')}` : ''}
                          {' · '}
                          {user.lastLogin
                            ? t('users.lastSignedIn', {
                                when: formatFinanceDateTime(user.lastLogin),
                              })
                            : t('users.neverSignedIn')}
                        </p>
                      </div>

                      {canAdminister ? (
                        <div className="flex flex-wrap items-end gap-2">
                          <Field label={t('users.roleFor', { email: user.email })} className="w-44">
                            <Select
                              value={user.role}
                              disabled={busy || isSelf}
                              onChange={(event) =>
                                void patch(
                                  user,
                                  { role: event.target.value },
                                  t('users.roleChanged', {
                                    email: user.email,
                                    role: t(`roles.${event.target.value}`),
                                  }),
                                )
                              }
                            >
                              {Object.values(UserRole).map((value) => (
                                <option key={value} value={value}>
                                  {t(`roles.${value}`)}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field
                            label={t('users.statusFor', { email: user.email })}
                            className="w-40"
                          >
                            <Select
                              value={user.status}
                              disabled={busy || isSelf}
                              onChange={(event) =>
                                void patch(
                                  user,
                                  { status: event.target.value },
                                  t('users.statusChanged', {
                                    email: user.email,
                                    status: event.target.value.toLowerCase(),
                                  }),
                                )
                              }
                            >
                              {Object.values(UserStatus).map((value) => (
                                <option key={value} value={value}>
                                  {value.toLowerCase()}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => void resetPassword(user)}
                          >
                            {t('users.resetPassword')}
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => void revokeSessions(user)}
                          >
                            {t('users.signOutSessions')}
                          </Button>
                        </div>
                      ) : (
                        <p className="text-sm text-text-muted">{t('users.readOnly')}</p>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={result.page}
              limit={result.limit}
              total={result.total}
              onPage={setPage}
            />
          </>
        )}
      </Resource>
    </main>
  );
}
