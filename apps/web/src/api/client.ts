import axios, { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/useAuth';
import { apiBaseUrl } from './config';

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true, // For sending HTTP-only cookies
  timeout: 60_000,
});

/** Correlates a browser action with the server log line it produced. */
const correlationId = () =>
  globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  const headers = AxiosHeaders.from(config.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-Request-Id', correlationId());
  config.headers = headers;
  return config;
});

/**
 * One refresh at a time.
 *
 * A dashboard fires several requests at once. When the access token has just
 * expired they all fail together, and each used to start its own refresh —
 * which, now that presenting an already-rotated refresh token is treated as
 * theft, would have every one of them but the first trigger reuse detection and
 * sign the user out. They share a single attempt instead.
 */
let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  refreshInFlight ??= axios
    .post(`${apiBaseUrl}/auth/refresh`, {}, { withCredentials: true })
    .then((response) => {
      const token = response.data.data.accessToken as string;
      // The token is stored whether or not a user is loaded yet, because
      // `restoreSession` below needs it *before* it can fetch the user. The
      // previous version only stored it when a user was already present, which
      // meant a fresh page load could mint a token and then throw it away.
      useAuthStore.getState().setAccessToken(token);
      return token;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/**
 * Re-establishes the session from the refresh cookie on start-up.
 *
 * The cookie is HTTP-only, so the app cannot read it and has to ask: if the
 * refresh succeeds there is a live session, and the user is fetched fresh
 * rather than restored from web storage. Fetching is the point — a cached user
 * would let a suspended account or a revoked role keep rendering the screens
 * it no longer has, until something happened to 401.
 */
export async function restoreSession(): Promise<void> {
  try {
    await refreshAccessToken();
    const response = await apiClient.get('/users/me');
    useAuthStore.getState().setAuth(response.data.data, useAuthStore.getState().accessToken!);
  } catch {
    // No session, or one the server no longer honours. Either way: anonymous.
    useAuthStore.getState().logout();
  } finally {
    useAuthStore.getState().markReady();
  }
}

/**
 * Ends the session on the server as well as in this tab.
 *
 * Clearing local state alone left the refresh cookie live, so the next visitor
 * to a shared warehouse terminal could simply reload the page and be signed in
 * as whoever used it last.
 */
export async function signOut(): Promise<void> {
  try {
    await apiClient.post('/auth/logout');
  } catch {
    // The server session may already be gone. Never leave the user stuck on a
    // screen they asked to leave because the sign-out call failed.
  }
  useAuthStore.getState().logout();
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    /**
     * The endpoints where 401 means "these credentials are wrong", not "this
     * access token expired".
     *
     * A failed refresh must not be retried through this path, or one expired
     * session becomes an endless loop of refresh attempts. Sign-in must not
     * either, and that omission was user-visible: mistyping a password made
     * this interceptor attempt a refresh, the refresh failed with "No refresh
     * token", and *that* was the sentence shown to the person at the keyboard.
     * A shop owner who fat-fingered their password was told the application had
     * no refresh token — while being signed out of a session they had never
     * established.
     */
    const isCredentialCall = /\/auth\/(refresh|login)/.test(originalRequest?.url ?? '');

    if (status === 401 && originalRequest && !originalRequest._retry && !isCredentialCall) {
      originalRequest._retry = true;
      try {
        const token = await refreshAccessToken();
        const headers = AxiosHeaders.from(originalRequest.headers);
        headers.set('Authorization', `Bearer ${token}`);
        originalRequest.headers = headers;
        return apiClient(originalRequest);
      } catch {
        // Local clear only, deliberately. Reaching here means the refresh token
        // was rejected, so the server session is already gone and `signOut`'s
        // POST would need the very credential that just failed. A user-initiated
        // sign-out is the case that must reach the server; this one cannot.
        useAuthStore.getState().logout();
        // The caller asked about *their* request, so they get their own error.
        // Substituting the refresh failure replaces a sentence about the thing
        // the user was doing with one about a mechanism they have never heard of.
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);

/**
 * The correlation identifier the server attached to a failure, so a support
 * message can quote the exact request rather than the time it happened.
 */
export function failureReference(error: unknown): string | undefined {
  const failure = error as { response?: { data?: { error?: { correlationId?: string } } } };
  return failure.response?.data?.error?.correlationId;
}
