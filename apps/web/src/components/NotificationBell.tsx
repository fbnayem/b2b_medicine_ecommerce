import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { Bell } from 'lucide-react';
import {
  RealtimeEvent,
  type NotificationCategory,
  type NotificationRecord,
  type UnreadNotificationSummary,
} from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';
import { useNotificationStore } from '../store/useNotifications';
import { useRealtimeEvent } from '../realtime/useRealtime';
import { formatFinanceDate } from '../lib/finance';
import { useLanguage } from '../lib/useLanguage';
import { EmptyState, ErrorState, LoadingState } from './ui';

/**
 * The bell, and the panel behind it.
 *
 * Every class name this component used — `notification-bell`, `bell-panel`,
 * `bell-item-title`, `link-button`, `state` — was defined in `inventory.css`,
 * which was deleted once the *pages* moved onto the design system. Nothing
 * caught it, because `uiDiscipline.test.ts` only ever globbed `pages/`. So the
 * panel had no position, no background, no z-index and no padding: it rendered
 * transparently over the page, and Tailwind's Preflight — which zeroes `h2`
 * and `p` margins and strips `ul` padding — closed the last gaps, leaving
 * "…submittedShafin Pharmacy submitted an order request.ORDER · 04 Aug 2026"
 * and "View all notificationsPreferences" as literal run-together text.
 *
 * Rebuilt on Radix, matching `AccountMenu` in `AppShell.tsx`: portalled, so it
 * cannot be trapped inside the header's stacking context, and dismissed by
 * Escape and outside-click without this component owning document listeners.
 * A popover rather than a menu, because the content is a list of links with a
 * heading and a footer rather than a set of commands.
 */

/** Newest first, and a date once "hours ago" stops being the useful answer. */
function relativeTime(
  value: string,
  t: (path: string, values?: Record<string, string | number>) => string,
): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return t('notifications.justNow');
  if (seconds < 3600) return t('notifications.minutesAgo', { count: Math.floor(seconds / 60) });
  if (seconds < 86_400) return t('notifications.hoursAgo', { count: Math.floor(seconds / 3600) });
  return formatFinanceDate(value);
}

export function NotificationBell() {
  const { t, c } = useLanguage();
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

  if (!isAuthenticated) return null;

  const openChanged = (next: boolean) => {
    setOpen(next);
    if (next) void loadRecent();
  };

  return (
    <Popover.Root open={open} onOpenChange={openChanged}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-test="notification-bell"
          aria-label={
            unread.total
              ? t('notifications.bellUnread', { count: unread.total })
              : t('notifications.bellNone')
          }
          className="relative flex size-11 items-center justify-center rounded-md border border-border text-text hover:bg-surface-hover"
        >
          <Bell aria-hidden="true" size={20} />
          {unread.total > 0 && (
            <span
              // `aria-hidden`: the count is already in the button's label, and
              // announcing it twice is worse than not styling it at all.
              aria-hidden="true"
              className="absolute -end-1 -top-1 min-w-5 rounded-full bg-danger px-1 text-center text-xs font-semibold leading-5 text-text-inverse"
            >
              {unread.total > 99 ? '99+' : unread.total}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-[200] flex max-h-[min(28rem,calc(100vh-5rem))] w-[min(24rem,calc(100vw-2rem))] flex-col rounded-lg border border-border bg-surface shadow-lg"
        >
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-text">{t('notifications.recent')}</h2>
            <button
              type="button"
              disabled={unread.total === 0}
              onClick={() => void markAllRead()}
              className="rounded text-sm text-brand underline underline-offset-2 disabled:text-text-muted disabled:no-underline"
            >
              {t('notifications.bellMarkAllRead')}
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {error ? (
              <ErrorState className="m-3" message={error} onRetry={() => void loadRecent()} />
            ) : loading ? (
              <LoadingState label={t('notifications.bellLoading')} />
            ) : recent.length === 0 ? (
              <EmptyState
                className="m-3 border-0 px-4 py-8"
                title={t('notifications.bellEmpty')}
                description={t('notifications.bellEmptyBody')}
              />
            ) : (
              <ul className="flex flex-col">
                {recent.map((notification) => {
                  const seen = Boolean(notification.readAt);
                  /*
                   * Blocks, not inline spans. The three were `<span>`s on
                   * adjacent JSX lines, and JSX drops whitespace-only lines
                   * between elements — which is why the title, the body and the
                   * meta arrived as one unbroken sentence.
                   */
                  const body = (
                    <>
                      <span className="flex items-center gap-2">
                        {!seen && (
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full bg-brand"
                          />
                        )}
                        <span className={seen ? 'text-text' : 'font-semibold text-text'}>
                          {notification.title}
                        </span>
                      </span>
                      <span className="block text-sm text-text-muted">{notification.body}</span>
                      <span className="block text-xs text-text-muted">
                        {/* Was the raw enum: rows read "ORDER · 04 Aug 2026". */}
                        {
                          c.notificationCategory[notification.category as NotificationCategory]
                        } · {relativeTime(notification.createdAt, t)}
                      </span>
                    </>
                  );
                  const rowClass = [
                    'flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-start',
                    'hover:bg-surface-hover',
                    seen ? '' : 'bg-brand-subtle/40',
                  ].join(' ');
                  return (
                    <li key={notification._id}>
                      {notification.link ? (
                        <Link
                          to={notification.link}
                          className={rowClass}
                          onClick={() => {
                            setOpen(false);
                            if (!seen) void markRead([notification._id]);
                          }}
                        >
                          {body}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className={rowClass}
                          onClick={() => {
                            if (!seen) void markRead([notification._id]);
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
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="text-sm text-brand underline underline-offset-2"
            >
              {t('notifications.viewAll')}
            </Link>
            <Link
              to="/notifications/preferences"
              onClick={() => setOpen(false)}
              className="text-sm text-brand underline underline-offset-2"
            >
              {t('notifications.preferencesTitle')}
            </Link>
          </footer>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
