import { io, type Socket } from 'socket.io-client';
import type { RealtimeEvent } from '@medsupply/shared-types';
import { baseURL } from '../api/client';
import { useAuthStore } from '../store/useAuth';

/** The socket lives at the server root, not under the `/api/v1` REST prefix. */
export function realtimeOrigin(apiBase = baseURL): string {
  return apiBase.replace(/\/api\/v1\/?$/, '');
}

let socket: Socket | null = null;

export function connectRealtime(): Socket | null {
  const token = useAuthStore.getState().accessToken;
  if (!token) return null;
  if (socket?.connected) return socket;

  socket?.disconnect();
  socket = io(realtimeOrigin(), {
    path: '/realtime',
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 15_000,
  });
  return socket;
}

export function disconnectRealtime() {
  socket?.disconnect();
  socket = null;
}

export function realtimeSocket(): Socket | null {
  return socket;
}

/** Subscribes to one event; returns a no-op unsubscribe when signed out. */
export function onRealtime(event: RealtimeEvent, handler: (payload: unknown) => void): () => void {
  const active = connectRealtime();
  if (!active) return () => {};
  active.on(event, handler);
  return () => {
    active.off(event, handler);
  };
}
