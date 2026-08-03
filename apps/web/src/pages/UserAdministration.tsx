import { useCallback, useEffect, useState } from 'react';
import { UserRole, UserStatus, type User } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import './inventory.css';
import { formatFinanceDateTime } from '../lib/finance';
import { requireReason, useAsk } from '../components/ui';
import { usePasswordPolicy } from '../lib/usePasswordPolicy';

interface DirectoryUser extends User {
  activeSessions?: number;
}

const roles = Object.values(UserRole);
const statuses = Object.values(UserStatus);
const PAGE_SIZE = 20;

function failureMessage(caught: unknown, fallback: string) {
  const failure = caught as { response?: { data?: { error?: { message?: string } } } };
  return failure.response?.data?.error?.message ?? fallback;
}

export function UserAdministration() {
  const currentUser = useAuthStore((state) => state.user);
  const ask = useAsk();
  // Read from System Settings rather than hard-coded, so an administrator is
  // held to the same minimum the server will enforce a moment later.
  const passwordMinLength = usePasswordPolicy();
  const [items, setItems] = useState<DirectoryUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busyId, setBusyId] = useState('');

  const canAdminister =
    currentUser?.role === UserRole.SUPER_ADMIN || currentUser?.role === UserRole.ADMIN;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/admin/users', {
        params: {
          page,
          limit: PAGE_SIZE,
          ...(role ? { role } : {}),
          ...(status ? { status } : {}),
          ...(query.trim() ? { q: query.trim() } : {}),
        },
      });
      setItems(response.data.data);
      setTotal(response.data.meta.total);
      setError('');
    } catch (caught) {
      setError(failureMessage(caught, 'Unable to load the user directory.'));
    } finally {
      setLoading(false);
    }
  }, [page, query, role, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (user: DirectoryUser, changes: Record<string, unknown>, note: string) => {
    setBusyId(user._id);
    setFeedback('');
    try {
      await apiClient.patch(`/admin/users/${user._id}`, changes);
      setFeedback(note);
      setError('');
      await load();
    } catch (caught) {
      setError(failureMessage(caught, 'Unable to update this account.'));
    } finally {
      setBusyId('');
    }
  };

  const resetPassword = async (user: DirectoryUser) => {
    /*
     * This was two `window.prompt` calls, the first of which took a password in
     * clear text — no masking, no validation against the configured minimum —
     * and the resulting credential was permanent, because nothing enforced
     * `forcePasswordChange` and no endpoint existed to satisfy it. Both halves
     * are fixed; this is the half the administrator sees.
     */
    const temporaryPassword = await ask.prompt({
      title: `Reset the password for ${user.firstName} ${user.lastName}`,
      description:
        'They will be asked to choose their own password the next time they sign in, and ' +
        'every device they are signed in on will be signed out.',
      label: 'Temporary password',
      hint: `At least ${passwordMinLength} characters. Read it to them; it is shown only now.`,
      type: 'password',
      confirmLabel: 'Reset password',
      danger: true,
      validate: (value) =>
        value.length < passwordMinLength ? `Use at least ${passwordMinLength} characters.` : null,
    });
    if (!temporaryPassword) return;

    const reason = await ask.prompt({
      title: 'Why is this password being reset?',
      description: 'This is recorded in the audit log against your name.',
      label: 'Reason',
      multiline: true,
      confirmLabel: 'Reset password',
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
      setFeedback(`Password reset for ${user.email}. All their sessions were signed out.`);
      setError('');
      await load();
    } catch (caught) {
      setError(failureMessage(caught, 'Unable to reset this password.'));
    } finally {
      setBusyId('');
    }
  };

  const revokeSessions = async (user: DirectoryUser) => {
    const reason = await ask.prompt({
      title: `Sign ${user.email} out everywhere?`,
      description:
        'Every device they are signed in on will be signed out immediately. They can sign back ' +
        'in with their existing password.',
      label: 'Reason',
      multiline: true,
      confirmLabel: 'Sign them out',
      danger: true,
      validate: requireReason(),
    });
    if (!reason) return;
    setBusyId(user._id);
    try {
      const response = await apiClient.post(`/admin/users/${user._id}/revoke-sessions`, { reason });
      setFeedback(`Signed out ${response.data.data.revoked} session(s) for ${user.email}.`);
      setError('');
      await load();
    } catch (caught) {
      setError(failureMessage(caught, 'Unable to sign out these sessions.'));
    } finally {
      setBusyId('');
    }
  };

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>User administration</h1>
          <p>
            Roles, account status, password resets and session revocation. Every change is audited.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()}>
          Reload
        </button>
      </header>

      <form
        className="search-bar"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          void load();
        }}
      >
        <label htmlFor="user-search">Search by name or email</label>
        <div>
          <input
            id="user-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="nusrat or nusrat@example.com"
          />
          <button type="submit">Search</button>
        </div>
      </form>

      <div className="notification-actions">
        <label htmlFor="user-role-filter">Role</label>
        <select
          id="user-role-filter"
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All roles</option>
          {roles.map((value) => (
            <option key={value} value={value}>
              {value.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <label htmlFor="user-status-filter">Status</label>
        <select
          id="user-status-filter"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {statuses.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      {feedback ? <p className="state success">{feedback}</p> : null}
      {error ? (
        <section className="state error">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}

      {loading ? (
        <section className="state">Loading users...</section>
      ) : items.length === 0 ? (
        <section className="state">No users match this filter.</section>
      ) : (
        <section className="notification-list">
          {items.map((user) => {
            const isSelf = user._id === currentUser?._id;
            const busy = busyId === user._id;
            return (
              <article key={user._id} className="notification-row">
                <div>
                  <p className="notification-title">
                    {user.firstName} {user.lastName}
                    {isSelf ? ' (you)' : ''}
                  </p>
                  <p>{user.email}</p>
                  <p className="notification-meta">
                    {user.role.replaceAll('_', ' ')} · {user.status}
                    {user.forcePasswordChange ? ' · password change pending' : ''}
                    {user.lastLogin
                      ? ` · last signed in ${formatFinanceDateTime(user.lastLogin)}`
                      : ' · never signed in'}
                  </p>
                </div>
                {canAdminister ? (
                  <div className="notification-row-actions">
                    <label className="visually-hidden" htmlFor={`role-${user._id}`}>
                      Role for {user.email}
                    </label>
                    <select
                      id={`role-${user._id}`}
                      value={user.role}
                      disabled={busy || isSelf}
                      onChange={(event) =>
                        void patch(
                          user,
                          { role: event.target.value },
                          `${user.email} is now a ${event.target.value.replaceAll('_', ' ')}.`,
                        )
                      }
                    >
                      {roles.map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </select>
                    <label className="visually-hidden" htmlFor={`status-${user._id}`}>
                      Status for {user.email}
                    </label>
                    <select
                      id={`status-${user._id}`}
                      value={user.status}
                      disabled={busy || isSelf}
                      onChange={(event) =>
                        void patch(
                          user,
                          { status: event.target.value },
                          `${user.email} is now ${event.target.value}.`,
                        )
                      }
                    >
                      {statuses.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void resetPassword(user)}
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void revokeSessions(user)}
                    >
                      Sign out sessions
                    </button>
                  </div>
                ) : (
                  <div className="notification-row-actions">
                    <span className="status">Read only</span>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      <nav className="pagination" aria-label="User pages">
        <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {lastPage}
        </span>
        <button type="button" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </nav>
    </main>
  );
}
