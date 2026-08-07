import { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { UserRole } from '@medsupply/shared-types';
import { errorMessage } from '@medsupply/api-client';
import { apiClient } from '../../src/api/client';
import { useAuthStore } from '../../src/store/useAuth';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Button,
  Card,
  Field,
  Input,
  ListRow,
  Screen,
  SectionTitle,
  toast,
  useAsk,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

/**
 * Which roles each role may create.
 *
 * The server enforces this; the screen exists so nobody is offered a choice
 * that will be refused. A manager staffing the warehouse may add a storekeeper
 * or a rider and **not another manager** — promoting somebody is a decision an
 * administrator makes, and a form that offers it invites a 403 at the end of
 * six filled-in fields.
 */
const MAY_CREATE: Partial<Record<string, UserRole[]>> = {
  SUPER_ADMIN: Object.values(UserRole).filter((role) => role !== UserRole.SHOP_OWNER),
  ADMIN: [UserRole.MANAGER, UserRole.STOREKEEPER, UserRole.DELIVERY_PERSON, UserRole.SALES],
  MANAGER: [UserRole.STOREKEEPER, UserRole.DELIVERY_PERSON, UserRole.SALES],
};

/**
 * Adding somebody to the staff.
 *
 * A shop owner is **not** on the list of roles this creates. An owner account
 * belongs to a customer record and is attached through the shop, not minted
 * here — and `POST /auth/register` is the route a pharmacy opens its own
 * account by.
 */
export default function UserFormScreen() {
  const { t, language } = useLanguage();
  const ask = useAsk();
  const actorRole = useAuthStore((state) => state.user?.role);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [role, setRole] = useState<UserRole>();
  const [saving, setSaving] = useState(false);

  const allowed = MAY_CREATE[String(actorRole)] ?? [];

  async function chooseRole() {
    const chosen = await ask.choose({
      title: t('users.role'),
      description: t('users.roleHint'),
      options: allowed.map((value) => ({ value, label: t(`roles.${value}`) })),
    });
    if (chosen) setRole(chosen as UserRole);
  }

  async function save() {
    if (!role) {
      toast.error(t('users.needRole'));
      return;
    }
    if (form.firstName.trim().length < 2 || form.email.trim().length === 0) {
      toast.error(t('users.needNameAndEmail'));
      return;
    }

    setSaving(true);
    try {
      await apiClient.post('/users', {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        role,
      });
      /*
       * No password is set here. The server mints one and requires it to be
       * changed at first sign-in, which is why this screen never shows,
       * transmits or stores one — a password typed by the person creating the
       * account is a password two people know.
       */
      toast.success(t('users.created', { name: form.firstName.trim() }));
      router.replace('/(protected)/users');
    } catch (caught) {
      toast.error(errorMessage(caught, language, t('users.createFailed')));
    } finally {
      setSaving(false);
    }
  }

  if (allowed.length === 0) {
    return (
      <Screen>
        <Text style={{ color: colour.textMuted }}>{t('users.mayNotAdd')}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionTitle>{t('users.add')}</SectionTitle>

      <Card>
        <Field label={t('people.firstName')}>
          <Input
            label={t('people.firstName')}
            value={form.firstName}
            onChangeText={(value) => setForm((current) => ({ ...current, firstName: value }))}
          />
        </Field>
        <Field label={t('people.lastName')}>
          <Input
            label={t('people.lastName')}
            value={form.lastName}
            onChangeText={(value) => setForm((current) => ({ ...current, lastName: value }))}
          />
        </Field>
        <Field label={t('fields.email')}>
          <Input
            label={t('fields.email')}
            keyboardType="email-address"
            autoCapitalize="none"
            value={form.email}
            onChangeText={(value) => setForm((current) => ({ ...current, email: value }))}
          />
        </Field>
        <Field label={t('fields.phone')} hint={t('hints.supplierPhone')}>
          <Input
            label={t('fields.phone')}
            keyboardType="phone-pad"
            value={form.phone}
            onChangeText={(value) => setForm((current) => ({ ...current, phone: value }))}
          />
        </Field>

        <ListRow
          label={t('users.role')}
          value={role ? t(`roles.${role}`) : t('purchasing.notChosen')}
        />
        <Button
          variant="secondary"
          label={t('users.chooseRole')}
          onPress={() => void chooseRole()}
        />

        {/*
          Said before the button. Somebody filling this in wonders what password
          to give, and the answer is that they do not: the server mints one and
          the person changes it on first sign-in.
        */}
        <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
          {t('users.passwordNote')}
        </Text>
        <Button busy={saving} label={t('users.create')} onPress={() => void save()} />
      </Card>
    </Screen>
  );
}
