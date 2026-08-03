import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  NotificationCategory,
  RealtimeEvent,
  type NotificationRecord,
} from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useNotificationStore } from '../store/useNotifications';
import { useRealtimeEvent } from '../realtime/useRealtime';
import './inventory.css';
import { formatFinanceDateTime } from '../lib/finance';

const categories = ['', ...Object.values(NotificationCategory)] as const;
const PAGE_SIZE = 20;

export function Notifications() {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [category, setCategory] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const loadUnread = useNotificationStore((state) => state.loadUnread);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const response = await apiClient.get('/notifications', {
          params: {
            page,
            limit: PAGE_SIZE,
            ...(category ? { category } : {}),
            ...(unreadOnly ? { unreadOnly: true } : {}),
          },
        });
        setItems(response.data.data);
        setTotal(response.data.meta.total);
        setError('');
      } catch {
        setError('Unable to load notifications.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [category, page, unreadOnly],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeEvent(RealtimeEvent.NOTIFICATION_CREATED, () => void load(true));

  const changeFilter = (next: string) => {
    setCategory(next);
    setPage(1);
  };

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy('Marking as read...');
    try {
      await apiClient.post('/notifications/read', { notificationIds: ids });
      await Promise.all([load(true), loadUnread()]);
      setBusy('Marked as read.');
    } catch {
      setBusy('');
      setError('Unable to update these notifications.');
    }
  };

  const markAllRead = async () => {
    setBusy('Marking all as read...');
    try {
      await apiClient.post('/notifications/read-all', {
        ...(category ? { category } : {}),
        before: new Date().toISOString(),
      });
      await Promise.all([load(true), loadUnread()]);
      setBusy('All notifications marked as read.');
    } catch {
      setBusy('');
      setError('Unable to mark notifications as read.');
    }
  };

  const archive = async (id: string) => {
    setBusy('Archiving...');
    try {
      await apiClient.post('/notifications/archive', { notificationIds: [id] });
      await Promise.all([load(true), loadUnread()]);
      setBusy('Notification archived.');
    } catch {
      setBusy('');
      setError('Unable to archive this notification.');
    }
  };

  const unreadIds = items.filter((item) => !item.readAt).map((item) => item._id);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Activity</p>
          <h1>Notifications</h1>
          <p>Everything the system has told you, newest first.</p>
        </div>
        <Link className="secondary-button" to="/notifications/preferences">
          Preferences
        </Link>
      </header>

      <nav className="filter-tabs" aria-label="Notification category">
        {categories.map((value) => (
          <button
            key={value || 'all'}
            className={category === value ? 'selected' : ''}
            onClick={() => changeFilter(value)}
          >
            {value ? value.replaceAll('_', ' ') : 'All'}
          </button>
        ))}
      </nav>

      <div className="notification-actions">
        <label>
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked);
              setPage(1);
            }}
          />
          Unread only
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={!unreadIds.length}
          onClick={() => void markRead(unreadIds)}
        >
          Mark this page read
        </button>
        <button type="button" className="secondary-button" onClick={() => void markAllRead()}>
          Mark all read
        </button>
      </div>

      {busy ? <p className="state success">{busy}</p> : null}
      {error ? (
        <section className="state error">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}

      {loading ? (
        <section className="state">Loading notifications...</section>
      ) : items.length === 0 ? (
        <section className="state">
          {unreadOnly ? 'You have read everything here.' : 'No notifications in this category yet.'}
        </section>
      ) : (
        <section className="notification-list">
          {items.map((notification) => (
            <article
              key={notification._id}
              className={`notification-row ${notification.readAt ? '' : 'unread'}`}
            >
              <div>
                <p className="notification-title">
                  {notification.link ? (
                    <Link to={notification.link}>{notification.title}</Link>
                  ) : (
                    notification.title
                  )}
                </p>
                <p>{notification.body}</p>
                <p className="notification-meta">
                  {notification.category} · {notification.priority} ·{' '}
                  {formatFinanceDateTime(notification.createdAt)}
                </p>
              </div>
              <div className="notification-row-actions">
                {notification.readAt ? (
                  <span className="status">Read</span>
                ) : (
                  <button type="button" onClick={() => void markRead([notification._id])}>
                    Mark read
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void archive(notification._id)}
                >
                  Archive
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      <nav className="pagination" aria-label="Notification pages">
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
