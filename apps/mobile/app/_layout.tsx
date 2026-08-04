import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../src/store/useAuth';
import { apiClient, refreshTokens } from '../src/api/client';
import { useBranding } from '../src/settings/branding';
import { LanguageProvider, useLanguage } from '../src/i18n/useLanguage';
import { LoadingState } from '../src/components';
import { Screen } from '../src/components';

/**
 * Waits inside the language provider, so even the splash is translated.
 *
 * The web client's equivalent deliberately does not translate its splash,
 * because there it renders *above* the provider. Here the provider wraps the
 * whole tree, so there is no reason to leave this one string in English.
 */
function SessionSplash() {
  const { t } = useLanguage();
  return (
    <Screen>
      <LoadingState label={t('auth.restoringSession')} />
    </Screen>
  );
}

export default function RootLayout() {
  const { setAuth, logout, isAuthenticated } = useAuthStore();
  const [loading, setLoading] = useState(true);

  // Renders every amount and date in the tenant's currency, zone and pattern
  // rather than the package defaults, and supplies the tenant's language to the
  // provider below. Runs once a session exists, because the branding endpoint
  // is authenticated.
  const branding = useBranding(isAuthenticated);

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

  return (
    <LanguageProvider tenantDefault={branding.locale}>
      {loading ? (
        <SessionSplash />
      ) : (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={!isAuthenticated}>
            <Stack.Screen name="index" />
          </Stack.Protected>
          <Stack.Protected guard={isAuthenticated}>
            <Stack.Screen name="(protected)" />
          </Stack.Protected>
        </Stack>
      )}
    </LanguageProvider>
  );
}
