import { useEffect, useRef } from 'react';
import type { RealtimeEvent } from '@medsupply/shared-types';
import { onRealtime } from './socket';

/**
 * Runs `handler` whenever the server pushes `event`. The handler is held in a
 * ref so a component can pass an inline closure without resubscribing on every
 * render — resubscribing mid-stream is how updates get missed.
 */
export function useRealtimeEvent<T = unknown>(
  event: RealtimeEvent,
  handler: (payload: T) => void,
  enabled = true,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    return onRealtime(event, (payload) => handlerRef.current(payload as T));
  }, [event, enabled]);
}

/**
 * Refetches on a realtime signal, with a polling fallback so a blocked
 * websocket degrades to the Phase 7 behaviour instead of going stale.
 */
export function useLiveRefresh(
  event: RealtimeEvent,
  refresh: () => void,
  fallbackIntervalMs = 30_000,
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useRealtimeEvent(event, () => refreshRef.current());

  useEffect(() => {
    if (!fallbackIntervalMs) return;
    const timer = window.setInterval(() => refreshRef.current(), fallbackIntervalMs);
    return () => window.clearInterval(timer);
  }, [fallbackIntervalMs]);
}
