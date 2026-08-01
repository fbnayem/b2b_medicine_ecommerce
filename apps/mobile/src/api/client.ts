import axios from 'axios';
import { useAuthStore } from '../store/useAuth';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Expo inlines statically referenced EXPO_PUBLIC_* values. The fallback is local development only.
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
export const baseURL =
  configuredApiUrl ||
  (Platform.OS === 'android' ? 'http://10.0.2.2:5000/api/v1' : 'http://localhost:5000/api/v1');

type TokenPair = { accessToken: string; refreshToken: string };
let refreshRequest: Promise<TokenPair> | null = null;

export const apiClient = axios.create({
  baseURL,
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
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

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const { accessToken, refreshToken: newRefreshToken } = await refreshTokens();
        const user = useAuthStore.getState().user;

        if (!user) throw new Error('No authenticated user');
        await useAuthStore.getState().setAuth(user, accessToken, newRefreshToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        await useAuthStore.getState().logout();
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  },
);
