import { Stack } from 'expo-router';
import { useAuthStore } from '../src/store/useAuth';
import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { apiClient, refreshTokens } from '../src/api/client';
import { View, Text } from 'react-native';
import { useBrandingFormatting } from '../src/settings/branding';

export default function RootLayout() {
  const { setAuth, logout, isAuthenticated } = useAuthStore();
  const [loading, setLoading] = useState(true);

  // Renders every amount and date in the tenant's currency, zone and pattern
  // rather than the package defaults. Runs once a session exists, because the
  // branding endpoint is authenticated.
  useBrandingFormatting(isAuthenticated);

  useEffect(() => {
    async function checkAuth() {
      try {
        const token = await SecureStore.getItemAsync('refreshToken');
        if (token) {
          const tokens = await refreshTokens();
          const userRes = await apiClient.get('/users/me', {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
          });
          await setAuth(userRes.data.data, tokens.accessToken, tokens.refreshToken);
        }
      } catch {
        await logout();
      } finally {
        setLoading(false);
      }
    }
    checkAuth();
  }, [logout, setAuth]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(protected)" />
      </Stack.Protected>
    </Stack>
  );
}
