import axios from 'axios';
import { REQUEST_TIMEOUT_MS, correlationId, shouldAttemptRefresh } from '@medsupply/api-client';
import { useAuthStore } from '../store/useAuth';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Expo inlines statically referenced EXPO_PUBLIC_* values. The fallback is local development only.
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
export const baseURL =
  configuredApiUrl ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:5000/api/v1' : 'http://localhost:5000/api/v1');

/**
 * A product photograph's address, from the path the catalogue stores.
 *
 * `/media` is served **above** the versioned API — `baseURL` ends in `/api/v1`
 * and a media path begins at the root — so joining the two naively produces
 * `…/api/v1/media/…`, which is a 404 and renders as a silently blank image.
 *
 * Unauthenticated by design, and that decision is recorded in
 * `middlewares/media.ts`: a picture of a box tells a stranger what the box
 * looks like, while prices, stock and customers stay behind the API. Which is
 * why this is a plain URL and not an authorised fetch — React Native's `Image`
 * cannot attach a bearer token to one anyway.
 *
 * An absolute URL is passed through untouched, so a catalogue that later points
 * at a CDN needs no change here.
 */
export function mediaUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const root = baseURL.replace(/\/api\/v\d+$/, '');
  return `${root}${path.startsWith('/') ? path : `/${path}`}`;
}

type TokenPair = { accessToken: string; refreshToken: string };
let refreshRequest: Promise<TokenPair> | null = null;

export const apiClient = axios.create({
  baseURL,
  /*
   * There was no timeout at all. A request over a rural cellular connection
   * that never answers left a rider looking at a spinner with no way back —
   * which, on the delivery screens, means standing at a shop counter unable to
   * confirm a delivery they have already made.
   */
  timeout: REQUEST_TIMEOUT_MS,
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // So a failure on a phone can be traced to the exact server log line.
  config.headers['X-Request-Id'] = correlationId();
  return config;
});

export function refreshTokens(): Promise<TokenPair> {
  if (refreshRequest) return refreshRequest;

  refreshRequest = (async () => {
    const refreshToken = await SecureStore.getItemAsync('refreshToken');
    if (!refreshToken) throw new Error('No refresh token');
    const response = await axios.post<{ data: TokenPair }>(`${baseURL}/auth/refresh`, {
      refreshToken,
    });
    const tokens = response.data.data;
    // Persist the rotated credential before another request can attempt reuse.
    await SecureStore.setItemAsync('refreshToken', tokens.refreshToken);
    return tokens;
  })().finally(() => {
    refreshRequest = null;
  });

  return refreshRequest;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as typeof error.config & { _retry?: boolean };

    /*
     * The shared policy, rather than this client's own answer.
     *
     * This condition used to be `status === 401 && !_retry`, which is wrong in
     * two ways web had already fixed: a failed `/auth/refresh` was retried
     * through the refresh path, making one expired session an endless loop; and
     * a mistyped password at sign-in was treated as an expired token, so the
     * user was shown the refresh failure instead of "that password is wrong"
     * and was signed out of a session they never had.
     */
    if (
      shouldAttemptRefresh({
        status: error.response?.status,
        url: originalRequest?.url,
        alreadyRetried: originalRequest?._retry,
      })
    ) {
      originalRequest._retry = true;
      try {
        const { accessToken, refreshToken: newRefreshToken } = await refreshTokens();
        const user = useAuthStore.getState().user;

        if (!user) throw new Error('No authenticated user');
        await useAuthStore.getState().setAuth(user, accessToken, newRefreshToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch {
        await useAuthStore.getState().logout();
        // The caller asked about *their* request, so they get their own error.
        // Substituting the refresh failure replaces a sentence about the thing
        // the user was doing with one about a mechanism they have never met.
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  },
);
