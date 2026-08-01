import { io, type Socket } from 'socket.io-client';
import { RealtimeEvent } from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';
import { realtimeOrigin } from '../api/config';

let socket: Socket | null = null;

/**
 * One shared connection per browser tab. The access token is sent through the
 * handshake `auth` payload rather than the query string so it never lands in
 * proxy or server access logs.
 */
export function connectRealtime(): Socket | null {
  const token = useAuthStore.getState().accessToken;
  if (!token) return null;
  if (socket?.connected) return socket;

  socket?.disconnect();
  socket = io(realtimeOrigin, {
    path: '/realtime',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });
  return socket;
}

export function realtimeSocket(): Socket | null {
  return socket;
}

export function disconnectRealtime() {
  socket?.disconnect();
  socket = null;
}

/**
 * Subscribes to one realtime event and returns the unsubscribe function.
 * Returns a no-op when the user is signed out, so callers need no guard.
 */
export function onRealtime(event: RealtimeEvent, handler: (payload: unknown) => void): () => void {
  const active = connectRealtime();
  if (!active) return () => {};
  active.on(event, handler);
  return () => {
    active.off(event, handler);
  };
}
