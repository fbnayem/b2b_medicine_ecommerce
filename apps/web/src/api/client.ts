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
      const user = useAuthStore.getState().user;
      if (user) useAuthStore.getState().setAuth(user, token);
      return token;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    // A failed refresh must not be retried through this path, or one expired
    // session becomes an endless loop of refresh attempts.
    const isRefreshCall = originalRequest?.url?.includes('/auth/refresh');

    if (status === 401 && originalRequest && !originalRequest._retry && !isRefreshCall) {
      originalRequest._retry = true;
      try {
        const token = await refreshAccessToken();
        const headers = AxiosHeaders.from(originalRequest.headers);
        headers.set('Authorization', `Bearer ${token}`);
        originalRequest.headers = headers;
        return apiClient(originalRequest);
      } catch (refreshError) {
        useAuthStore.getState().logout();
        return Promise.reject(refreshError);
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
