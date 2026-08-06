import { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { errorMessage } from '@medsupply/api-client';
import {
  PASSWORD_MINIMUM,
  changePassword,
  passwordProblem,
  type PasswordDraft,
  type PasswordProblem,
} from '../../src/security/password';
import { useLanguage } from '../../src/i18n/useLanguage';
import { Button, Card, Field, Input, Screen, SectionTitle, toast } from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * Changing your own password on the device most likely to be lost.
 *
 * `POST /api/v1/auth/change-password` shipped in the security phase with **no
 * mobile caller**. A rider whose handset was taken, or an owner who shared a
 * password with somebody who has since left, had to find a desktop.
 *
 * The consequence is stated **before** the button, not after: the endpoint ends
 * every other session on success. Somebody who changes a word and then finds
 * the shop's counter tablet signed out will read that as a fault unless they
 * were told.
 */
export default function ChangePasswordScreen() {
  const { t, language } = useLanguage();
  const [draft, setDraft] = useState<PasswordDraft>({ current: '', next: '', confirm: '' });
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  const problem = passwordProblem(draft);
  // Nothing is marked wrong until somebody has tried to save. A form that opens
  // red tells people they have made a mistake by arriving.
  const shown = attempted ? problem : null;
  const errorFor = (field: PasswordProblem['field']) =>
    shown?.field === field ? t(shown.key, shown.values) : undefined;

  const submit = async () => {
    setAttempted(true);
    if (problem) return;
    setBusy(true);
    setFailure('');
    try {
      const revoked = await changePassword(draft);
      /*
       * The number is said out loud rather than swallowed. "Changed" alone
       * leaves somebody to discover on their own that three other devices have
       * been signed out — which is the security behaviour working correctly and
       * reads as a fault if it arrives unannounced.
       */
      toast.success(
        revoked === 0
          ? t('auth.changed')
          : revoked === 1
            ? t('auth.oneOtherSignedOut')
            : t('auth.otherSignedOut', { count: revoked }),
      );
      router.back();
    } catch (caught) {
      setFailure(errorMessage(caught, language, t('auth.changeFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <SectionTitle>{t('auth.changeOwnTitle')}</SectionTitle>
      {/* Before the button, deliberately: this is what pressing it does. */}
      <Text style={{ color: colour.textMuted }}>{t('auth.changeOwnBody')}</Text>

      {failure ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colour.danger, fontSize: layout.fontSize.sm }}
        >
          {failure}
        </Text>
      ) : null}

      <Card>
        <Field
          label={t('auth.currentPassword')}
          hint={t('hints.currentPassword')}
          error={errorFor('current')}
        >
          <Input
            label={t('auth.currentPassword')}
            value={draft.current}
            onChangeText={(current) => setDraft({ ...draft, current })}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            invalid={shown?.field === 'current'}
          />
        </Field>

        <Field
          label={t('auth.newPassword')}
          hint={t('auth.atLeast', { minimum: PASSWORD_MINIMUM })}
          error={errorFor('next')}
        >
          <Input
            label={t('auth.newPassword')}
            value={draft.next}
            onChangeText={(next) => setDraft({ ...draft, next })}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            invalid={shown?.field === 'next'}
          />
        </Field>

        <Field
          label={t('auth.repeatPassword')}
          hint={t('hints.repeatPassword')}
          error={errorFor('confirm')}
        >
          <Input
            label={t('auth.repeatPassword')}
            value={draft.confirm}
            onChangeText={(confirm) => setDraft({ ...draft, confirm })}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            onSubmitEditing={() => void submit()}
            invalid={shown?.field === 'confirm'}
          />
        </Field>
      </Card>

      <Button label={t('auth.changeButton')} busy={busy} onPress={() => void submit()} />
    </Screen>
  );
}
