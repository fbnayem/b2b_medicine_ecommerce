import { create } from 'zustand';
import type {
  NotificationCategory,
  NotificationRecord,
  UnreadNotificationSummary,
} from '@medsupply/shared-types';
import { apiClient } from '../api/client';

interface NotificationState {
  unread: UnreadNotificationSummary;
  recent: NotificationRecord[];
  loading: boolean;
  error: string;
  loadUnread: () => Promise<void>;
  loadRecent: () => Promise<void>;
  /** Applied when the server pushes a new notification over the socket. */
  receive: (notification: NotificationRecord) => void;
  setUnread: (summary: UnreadNotificationSummary) => void;
  markRead: (notificationIds: string[]) => Promise<void>;
  markAllRead: (category?: NotificationCategory) => Promise<void>;
  reset: () => void;
}

const emptyUnread: UnreadNotificationSummary = {
  total: 0,
  byCategory: {} as UnreadNotificationSummary['byCategory'],
};

const RECENT_LIMIT = 10;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unread: emptyUnread,
  recent: [],
  loading: false,
  error: '',

  loadUnread: async () => {
    try {
      const response = await apiClient.get('/notifications/unread-count');
      set({ unread: response.data.data, error: '' });
    } catch {
      set({ error: 'Unable to load the notification count.' });
    }
  },

  loadRecent: async () => {
    set({ loading: true });
    try {
      const response = await apiClient.get('/notifications', {
        params: { limit: RECENT_LIMIT },
      });
      set({ recent: response.data.data, error: '' });
    } catch {
      set({ error: 'Unable to load notifications.' });
    } finally {
      set({ loading: false });
    }
  },

  receive: (notification) => {
    const { recent, unread } = get();
    // Guards against the socket and a refetch delivering the same record.
    if (recent.some((entry) => entry._id === notification._id)) return;
    set({
      recent: [notification, ...recent].slice(0, RECENT_LIMIT),
      unread: {
        total: unread.total + 1,
        byCategory: {
          ...unread.byCategory,
          [notification.category]: (unread.byCategory[notification.category] ?? 0) + 1,
        },
      },
    });
  },

  setUnread: (summary) => set({ unread: summary }),

  markRead: async (notificationIds) => {
    if (!notificationIds.length) return;
    const readAt = new Date().toISOString();
    set({
      recent: get().recent.map((entry) =>
        notificationIds.includes(entry._id) ? { ...entry, readAt } : entry,
      ),
    });
    await apiClient.post('/notifications/read', { notificationIds });
    await get().loadUnread();
  },

  markAllRead: async (category) => {
    await apiClient.post('/notifications/read-all', {
      ...(category ? { category } : {}),
      before: new Date().toISOString(),
    });
    await Promise.all([get().loadUnread(), get().loadRecent()]);
  },

  reset: () => set({ unread: emptyUnread, recent: [], error: '', loading: false }),
}));
