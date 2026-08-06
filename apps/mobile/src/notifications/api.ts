import type {
  NotificationCategory,
  NotificationChannel,
  NotificationEvent,
  NotificationPriority,
  NotificationRecord,
  UnreadNotificationSummary,
} from '@medsupply/shared-types';
import { apiClient } from '../api/client';

export interface NotificationPage {
  items: NotificationRecord[];
  total: number;
  page: number;
}

export interface CatalogueEntry {
  event: NotificationEvent;
  category: NotificationCategory;
  priority: NotificationPriority;
  defaultChannels: NotificationChannel[];
}

export interface PreferencePayload {
  defaultChannels: NotificationChannel[] | null;
  overrides: Array<{ event: NotificationEvent; channels: NotificationChannel[] }>;
  quietHours: { enabled: boolean; start: string; end: string };
  mutedEvents: NotificationEvent[];
}

export async function fetchNotifications(page = 1, unreadOnly = false): Promise<NotificationPage> {
  const response = await apiClient.get('/notifications', {
    params: { page, limit: 20, ...(unreadOnly ? { unreadOnly: true } : {}) },
  });
  return {
    items: response.data.data,
    total: response.data.meta.total,
    page: response.data.meta.page,
  };
}

export async function fetchUnreadSummary(): Promise<UnreadNotificationSummary> {
  const response = await apiClient.get('/notifications/unread-count');
  return response.data.data;
}

export async function markNotificationsRead(notificationIds: string[]) {
  if (!notificationIds.length) return;
  await apiClient.post('/notifications/read', { notificationIds });
}

export async function markAllNotificationsRead() {
  await apiClient.post('/notifications/read-all', { before: new Date().toISOString() });
}

/**
 * Take notifications out of the inbox.
 *
 * The only thing that removes anything from this list. Without it an inbox
 * grows for as long as the account exists — every order, every delivery, every
 * invoice — and "mark all as read" changes a dot, not the length. Web has
 * archived one at a time since the notification phase; this client had no
 * caller, so a pharmacy's inbox was permanent.
 */
export async function archiveNotifications(notificationIds: string[]) {
  if (!notificationIds.length) return;
  await apiClient.post('/notifications/archive', { notificationIds });
}

export async function fetchCatalogue(): Promise<{
  channels: NotificationChannel[];
  events: CatalogueEntry[];
}> {
  const response = await apiClient.get('/notifications/catalogue');
  return response.data.data;
}

export async function fetchPreferences(): Promise<PreferencePayload> {
  const response = await apiClient.get('/notifications/preferences');
  const saved = response.data.data;
  return {
    defaultChannels: saved.defaultChannels ?? null,
    overrides: saved.overrides ?? [],
    quietHours: saved.quietHours ?? { enabled: false, start: '22:00', end: '07:00' },
    mutedEvents: saved.mutedEvents ?? [],
  };
}

export async function savePreferences(payload: PreferencePayload) {
  await apiClient.put('/notifications/preferences', {
    ...(payload.defaultChannels ? { defaultChannels: payload.defaultChannels } : {}),
    overrides: payload.overrides,
    quietHours: payload.quietHours,
    mutedEvents: payload.mutedEvents,
  });
}

export interface ActivityItem {
  _id: string;
  summary: string;
  detail?: string;
  occurredAt: string;
  actorName?: string;
  actorRole?: string;
  category: NotificationCategory;
}

export async function fetchTimeline(entityType: string, entityId: string): Promise<ActivityItem[]> {
  const response = await apiClient.get('/activity/timeline', {
    params: { entityType, entityId, limit: 50 },
  });
  return response.data.data;
}

/**
 * Resolves the channels shown for an event: an explicit override, then the
 * account-wide default, then the server's template default.
 */
export function effectiveChannels(
  entry: CatalogueEntry,
  preference: PreferencePayload | null,
): NotificationChannel[] {
  const override = preference?.overrides.find((item) => item.event === entry.event);
  if (override) return override.channels;
  if (preference?.defaultChannels) return preference.defaultChannels;
  return entry.defaultChannels;
}

export function toggleChannel(
  entry: CatalogueEntry,
  preference: PreferencePayload,
  channel: NotificationChannel,
): PreferencePayload {
  const current = effectiveChannels(entry, preference);
  const channels = current.includes(channel)
    ? current.filter((value) => value !== channel)
    : [...current, channel];
  return {
    ...preference,
    overrides: [
      ...preference.overrides.filter((item) => item.event !== entry.event),
      { event: entry.event, channels },
    ],
  };
}

export function toggleMuted(
  entry: CatalogueEntry,
  preference: PreferencePayload,
): PreferencePayload {
  const muted = preference.mutedEvents.includes(entry.event)
    ? preference.mutedEvents.filter((value) => value !== entry.event)
    : [...preference.mutedEvents, entry.event];
  return { ...preference, mutedEvents: muted };
}
