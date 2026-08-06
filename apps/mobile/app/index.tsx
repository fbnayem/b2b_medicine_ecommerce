import { useState } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { APP_VARIANT_NAME, AppVariant } from '@medsupply/navigation';
import { translatedOr } from '@medsupply/i18n';
import { useAuthStore } from '../src/store/useAuth';
import { apiClient } from '../src/api/client';
import { APP_VARIANT, wrongAppMessage } from '../src/appVariant';
import { useLanguage } from '../src/i18n/useLanguage';
import { Button, Field, Input, Screen } from '../src/components';
import { colour, layout } from '../src/theme';

/**
 * Signing in, to whichever of the three applications this build is.
 *
 * Three things were wrong here and all three are the same mistake — the screen
 * was written before there was anything to write it against:
 *
 *   - **The title was the literal string "MedSupply B2B".** That is no longer
 *     the name of anything installed. A pharmacy owner opens *MedSupply Shop*
 *     and the first screen has to agree with the icon they tapped.
 *   - **Every word was hard-coded English** — "Email", "Password", "Login
 *     failed" — on the one screen every person sees before they have had the
 *     chance to switch language.
 *   - **It used bare `TextInput`s** with hand-written styles, so the inputs
 *     were below the 44px floor `layout.minTapTarget` exists to hold, and the
 *     button could be pressed twice.
 *
 * ## Refusing an account that belongs in another application
 *
 * The check happens **before `setAuth`**, so nothing is written to
 * `SecureStore`, and the session just issued is revoked on the way out rather
 * than left to expire. Signing in successfully and then being told to install
 * something else must not leave a usable credential on the handset.
 */
export default function SignInScreen() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setAuth = useAuthStore((state) => state.setAuth);

  const appName = translatedOr(t, `appVariant.${APP_VARIANT}`, APP_VARIANT_NAME[APP_VARIANT]);

  const signIn = async () => {
    setError('');
    setBusy(true);
    try {
      const response = await apiClient.post('/auth/login', { email, password });
      const { user, accessToken, refreshToken } = response.data.data;

      const refusal = wrongAppMessage(user.role, t);
      if (refusal) {
        // Best effort: the session is theirs and valid, it is simply not wanted
        // here. A network failure on the way out must not hide the real reason.
        try {
          await apiClient.post(
            '/auth/logout',
            { refreshToken },
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
        } catch {
          /* Never stored on this device, so it expires unused either way. */
        }
        setError(refusal);
        return;
      }

      await setAuth(user, accessToken, refreshToken);
      router.replace('/(protected)/(tabs)/dashboard');
    } catch (err) {
      const message = (err as { response?: { data?: { error?: { message?: string } } } }).response
        ?.data?.error?.message;
      setError(message || t('auth.signInFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen style={{ justifyContent: 'center', gap: layout.space[4] }}>
      <View style={{ gap: layout.space[1] }}>
        <Text
          accessibilityRole="header"
          style={{
            fontSize: layout.fontSize.xl,
            fontWeight: layout.fontWeight.bold,
            color: colour.text,
            textAlign: 'center',
          }}
        >
          {appName}
        </Text>
        <Text
          style={{ fontSize: layout.fontSize.sm, color: colour.textMuted, textAlign: 'center' }}
        >
          {t('auth.signInTitle')}
        </Text>
      </View>

      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colour.danger, fontSize: layout.fontSize.sm, textAlign: 'center' }}
        >
          {error}
        </Text>
      ) : null}

      <Field label={t('auth.email')}>
        <Input
          label={t('auth.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          invalid={Boolean(error)}
        />
      </Field>

      <Field label={t('auth.password')}>
        <Input
          label={t('auth.password')}
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          secureTextEntry
          onSubmitEditing={() => void signIn()}
          invalid={Boolean(error)}
        />
      </Field>

      <Button
        label={t('auth.signInTitle')}
        onPress={() => void signIn()}
        busy={busy}
        disabled={!email || !password}
      />

      {/*
        Shop only. A rider or a storekeeper has an account created for them by
        an administrator, so offering them "register your pharmacy" would be an
        invitation to make something nobody can use — and the route is not even
        registered in those builds.
      */}
      {APP_VARIANT === AppVariant.SHOP ? (
        <Button
          variant="secondary"
          label={t('register.link')}
          onPress={() => router.push('/register')}
        />
      ) : null}
    </Screen>
  );
}
