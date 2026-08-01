import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import {
  RealtimeEvent,
  type NotificationRecord,
  type UnreadNotificationSummary,
} from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';
import { useNotificationStore } from '../store/useNotifications';
import { useRealtimeEvent } from '../realtime/useRealtime';

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(value).toLocaleDateString('en-BD', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function NotificationBell() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const unread = useNotificationStore((state) => state.unread);
  const recent = useNotificationStore((state) => state.recent);
  const loading = useNotificationStore((state) => state.loading);
  const error = useNotificationStore((state) => state.error);
  const loadUnread = useNotificationStore((state) => state.loadUnread);
  const loadRecent = useNotificationStore((state) => state.loadRecent);
  const receive = useNotificationStore((state) => state.receive);
  const setUnread = useNotificationStore((state) => state.setUnread);
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadUnread();
  }, [isAuthenticated, loadUnread]);

  useRealtimeEvent<NotificationRecord>(
    RealtimeEvent.NOTIFICATION_CREATED,
    (payload) => receive(payload),
    isAuthenticated,
  );
  useRealtimeEvent<UnreadNotificationSummary>(
    RealtimeEvent.UNREAD_COUNT,
    (payload) => setUnread(payload),
    isAuthenticated,
  );

  // Closing on an outside click keeps the panel from covering the page content.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!isAuthenticated) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void loadRecent();
  };

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        type="button"
        className="bell-button"
        aria-label={
          unread.total ? `Notifications, ${unread.total} unread` : 'Notifications, none unread'
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <Bell aria-hidden="true" size={20} />
        {unread.total > 0 ? (
          <span className="bell-badge">{unread.total > 99 ? '99+' : unread.total}</span>
        ) : null}
      </button>

      {open ? (
        <div className="bell-panel" role="dialog" aria-label="Recent notifications">
          <header>
            <h2>Notifications</h2>
            <button
              type="button"
              className="link-button"
              disabled={unread.total === 0}
              onClick={() => void markAllRead()}
            >
              Mark all read
            </button>
          </header>

          {error ? (
            <p className="state error">
              {error}
              <button type="button" onClick={() => void loadRecent()}>
                Retry
              </button>
            </p>
          ) : null}

          {loading ? (
            <p className="state">Loading notifications...</p>
          ) : recent.length === 0 ? (
            <p className="state">You have no notifications yet.</p>
          ) : (
            <ul>
              {recent.map((notification) => {
                const body = (
                  <>
                    <span className="bell-item-title">{notification.title}</span>
                    <span className="bell-item-body">{notification.body}</span>
                    <span className="bell-item-meta">
                      {notification.category} · {relativeTime(notification.createdAt)}
                    </span>
                  </>
                );
                return (
                  <li key={notification._id} className={notification.readAt ? '' : 'unread'}>
                    {notification.link ? (
                      <Link
                        to={notification.link}
                        onClick={() => {
                          setOpen(false);
                          if (!notification.readAt) void markRead([notification._id]);
                        }}
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="bell-item-plain"
                        onClick={() => {
                          if (!notification.readAt) void markRead([notification._id]);
                        }}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <footer>
            <Link to="/notifications" onClick={() => setOpen(false)}>
              View all notifications
            </Link>
            <Link to="/notifications/preferences" onClick={() => setOpen(false)}>
              Preferences
            </Link>
          </footer>
        </div>
      ) : null}
    </div>
  );
}
