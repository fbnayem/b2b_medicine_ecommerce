import { useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { APP_VARIANT_NAME } from '@medsupply/navigation';
import { translatedOr } from '@medsupply/i18n';
import { errorMessage } from '@medsupply/api-client';
import {
  REGISTRATION_PASSWORD_MINIMUM,
  emptyRegistration,
  registerShop,
  registrationProblem,
  type RegistrationDraft,
  type RegistrationField,
} from '../src/account/registration';
import { APP_VARIANT } from '../src/appVariant';
import { useLanguage } from '../src/i18n/useLanguage';
import { Button, Card, Field, Input, Screen, SectionTitle } from '../src/components';
import { colour, layout } from '../src/theme';

/**
 * A pharmacy opening its own account.
 *
 * Only in **MedSupply Shop**. A rider or a storekeeper is somebody the
 * distributor employs; an account is created for them by an administrator, and
 * a "register" link in those builds would be an invitation to make an account
 * that nobody can use.
 *
 * ## What this form deliberately does not ask
 *
 * Credit limit, payment terms, discount and price list. A customer does not set
 * their own commercial terms — the server writes those as zero, zero, zero and
 * none, and a manager sets them afterwards from the "no terms set yet" queue.
 * The shop can trade prepaid immediately and its first credit order is refused
 * at approval until somebody decides otherwise. That is said plainly at the
 * bottom of this screen rather than discovered a week later.
 */
export default function RegisterScreen() {
  const { t, language } = useLanguage();
  const [draft, setDraft] = useState<RegistrationDraft>(emptyRegistration);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [done, setDone] = useState<{ reference: string; name: string }>();

  const appName = translatedOr(t, `appVariant.${APP_VARIANT}`, APP_VARIANT_NAME[APP_VARIANT]);
  const problem = registrationProblem(draft);
  const shown = attempted ? problem : null;
  const errorFor = (field: RegistrationField) =>
    shown?.field === field ? t(shown.key, shown.values) : undefined;

  const set = (field: RegistrationField) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const submit = async () => {
    setAttempted(true);
    if (problem) return;
    setBusy(true);
    setFailure('');
    try {
      const created = await registerShop(draft);
      setDone(created.shop);
    } catch (caught) {
      setFailure(errorMessage(caught, language, t('register.failed')));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    /*
     * Registering is not signing in — no token is issued, because sign-in is
     * where lockout, forced password changes and the wrong-application refusal
     * live. So this screen ends by handing them to the sign-in form with their
     * shop's reference, which is the number to quote if they telephone.
     */
    return (
      <Screen style={{ justifyContent: 'center', gap: layout.space[4] }}>
        <SectionTitle>{t('register.doneTitle')}</SectionTitle>
        <Card>
          <Text style={{ color: colour.text, fontWeight: '600', fontSize: layout.fontSize.lg }}>
            {done.name}
          </Text>
          <Text style={{ color: colour.brand, fontWeight: '600' }}>{done.reference}</Text>
          <Text style={{ color: colour.textMuted }}>{t('register.doneBody')}</Text>
        </Card>
        <Button label={t('common.signIn')} onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionTitle>{t('register.title', { app: appName })}</SectionTitle>
      <Text style={{ color: colour.textMuted }}>{t('register.subtitle')}</Text>

      {failure ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colour.danger, fontSize: layout.fontSize.sm }}
        >
          {failure}
        </Text>
      ) : null}

      <Card>
        <SectionTitle>{t('register.aboutYou')}</SectionTitle>
        <View style={{ flexDirection: 'row', gap: layout.space[3] }}>
          <Field label={t('people.firstName')} error={errorFor('firstName')} style={{ flex: 1 }}>
            <Input
              label={t('people.firstName')}
              value={draft.firstName}
              onChangeText={set('firstName')}
              autoComplete="given-name"
              invalid={shown?.field === 'firstName'}
            />
          </Field>
          <Field label={t('people.lastName')} error={errorFor('lastName')} style={{ flex: 1 }}>
            <Input
              label={t('people.lastName')}
              value={draft.lastName}
              onChangeText={set('lastName')}
              autoComplete="family-name"
              invalid={shown?.field === 'lastName'}
            />
          </Field>
        </View>

        <Field label={t('auth.email')} hint={t('register.emailHint')} error={errorFor('email')}>
          <Input
            label={t('auth.email')}
            value={draft.email}
            onChangeText={set('email')}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            invalid={shown?.field === 'email'}
          />
        </Field>

        <Field
          label={t('auth.password')}
          hint={t('auth.atLeast', { minimum: REGISTRATION_PASSWORD_MINIMUM })}
          error={errorFor('password')}
        >
          <Input
            label={t('auth.password')}
            value={draft.password}
            onChangeText={set('password')}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            invalid={shown?.field === 'password'}
          />
        </Field>
      </Card>

      <Card>
        <SectionTitle>{t('register.aboutShop')}</SectionTitle>
        <Field label={t('shops.name')} error={errorFor('shopName')}>
          <Input
            label={t('shops.name')}
            value={draft.shopName}
            onChangeText={set('shopName')}
            invalid={shown?.field === 'shopName'}
          />
        </Field>

        <Field
          label={t('fields.phone')}
          hint={t('register.phoneHint')}
          error={errorFor('primaryPhone')}
        >
          <Input
            label={t('fields.phone')}
            value={draft.primaryPhone}
            onChangeText={set('primaryPhone')}
            keyboardType="phone-pad"
            autoComplete="tel"
            invalid={shown?.field === 'primaryPhone'}
          />
        </Field>

        <Field
          label={t('shops.drugLicenceNumber')}
          hint={t('register.licenceHint')}
          error={errorFor('drugLicenceNumber')}
        >
          <Input
            label={t('shops.drugLicenceNumber')}
            value={draft.drugLicenceNumber}
            onChangeText={set('drugLicenceNumber')}
            autoCapitalize="characters"
            invalid={shown?.field === 'drugLicenceNumber'}
          />
        </Field>
      </Card>

      <Card>
        <SectionTitle>{t('addresses.title')}</SectionTitle>
        <Field
          label={t('addresses.line1')}
          hint={t('addresses.line1Hint')}
          error={errorFor('line1')}
        >
          <Input
            label={t('addresses.line1')}
            value={draft.line1}
            onChangeText={set('line1')}
            invalid={shown?.field === 'line1'}
          />
        </Field>
        <View style={{ flexDirection: 'row', gap: layout.space[3] }}>
          <Field label={t('addresses.city')} error={errorFor('city')} style={{ flex: 1 }}>
            <Input
              label={t('addresses.city')}
              value={draft.city}
              onChangeText={set('city')}
              invalid={shown?.field === 'city'}
            />
          </Field>
          <Field label={t('addresses.district')} error={errorFor('district')} style={{ flex: 1 }}>
            <Input
              label={t('addresses.district')}
              value={draft.district}
              onChangeText={set('district')}
              onSubmitEditing={() => void submit()}
              invalid={shown?.field === 'district'}
            />
          </Field>
        </View>
      </Card>

      {/*
        Before the button. What a shop can and cannot do on the day they
        register is the one thing they will otherwise find out by trying and
        failing — and "your order was refused" is a bad way to learn that terms
        have to be agreed.
      */}
      <Card>
        <Text style={{ color: colour.text, fontWeight: '600' }}>{t('register.termsTitle')}</Text>
        <Text style={{ color: colour.textMuted }}>{t('register.termsBody')}</Text>
      </Card>

      <Button label={t('register.submit')} busy={busy} onPress={() => void submit()} />
      <Button
        variant="secondary"
        label={t('register.haveAccount')}
        onPress={() => router.replace('/')}
      />
    </Screen>
  );
}
