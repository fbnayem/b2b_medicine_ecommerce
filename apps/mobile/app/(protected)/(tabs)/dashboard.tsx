import { useCallback, useEffect, useState } from 'react';
import { Text, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { RealtimeEvent, UserRole, type UnreadNotificationSummary } from '@medsupply/shared-types';
import { NAV_GROUP_LABEL, navItemsFor } from '@medsupply/navigation';
import { translatedOr } from '@medsupply/i18n';
import { useAuthStore } from '../../../src/store/useAuth';
import { getFinanceNavigation } from '../../../src/finance/navigation';
import { fetchUnreadSummary } from '../../../src/notifications/api';
import { disconnectRealtime, onRealtime } from '../../../src/notifications/realtime';
import { unregisterCurrentDevice } from '../../../src/notifications/push';
import { TAB_ROUTE_FILE } from '../../../src/navigation/tabs';
import { colour, layout } from '../../../src/theme';
import { useLanguage } from '../../../src/i18n/useLanguage';
import { CustomerHome } from '../../../src/home/CustomerHome';

const emptyUnread: UnreadNotificationSummary = {
  total: 0,
  byCategory: {} as UnreadNotificationSummary['byCategory'],
};

const GROUPS = [
  'work',
  'catalogue',
  'purchasing',
  'money',
  'insight',
  'administration',
  'account',
] as const;

/**
 * The mobile home screen.
 *
 * Its list of destinations used to be hand-written here behind nine separate
 * role checks — a fifth copy of the permission matrix, and one that had already
 * drifted: it offered a manager "Delivery operations" and a rider "Assigned
 * deliveries" through two buttons pointing at the same screen. It is now
 * generated from `@medsupply/navigation`, the same source the tab bar and the
 * web sidebar read.
 *
 * The tab bar carries the five things a role does most; this screen carries
 * everything else that role is allowed to reach.
 */
export default function DashboardScreen() {
  const { t } = useLanguage();
  const { user, logout } = useAuthStore();
  const [unread, setUnread] = useState<UnreadNotificationSummary>(emptyUnread);

  const loadUnread = useCallback(async () => {
    try {
      setUnread(await fetchUnreadSummary());
    } catch {
      // A failed count must not block the dashboard; the badge simply stays put.
    }
  }, []);

  // Refreshes on focus so returning from the inbox shows the corrected count.
  useFocusEffect(
    useCallback(() => {
      void loadUnread();
    }, [loadUnread]),
  );

  useEffect(
    () =>
      onRealtime(RealtimeEvent.UNREAD_COUNT, (payload) =>
        setUnread(payload as UnreadNotificationSummary),
      ),
    [],
  );

  const handleLogout = async () => {
    // Removes this device's push token before the credential is cleared.
    await unregisterCurrentDevice();
    disconnectRealtime();
    await logout();
    router.replace('/');
  };

  const role = user?.role as UserRole | undefined;
  const destinations = role
    ? navItemsFor(role).filter((item) => item.id !== 'dashboard' && TAB_ROUTE_FILE[item.id])
    : [];
  const financeLinks = getFinanceNavigation(role);

  const groups = GROUPS.map((group) => ({
    group,
    items: destinations.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);

  /*
   * A shop owner opens this to ask three questions — what do I owe, what is
   * coming, and can I have that again — and got a list of buttons instead. The
   * menu is still needed, so it is handed to `CustomerHome` and rendered under
   * the summary rather than replaced.
   *
   * Only the Shop application ever takes this branch, because a build admits
   * one set of roles.
   */
  const menu = (
    <>
      {groups.map(({ group, items }) => (
        <View key={group} style={styles.group}>
          <Text style={styles.groupHeading}>
            {translatedOr(t, `navGroup.${group}`, NAV_GROUP_LABEL[group])}
          </Text>
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              style={styles.secondaryAction}
              onPress={() => router.push(`/(protected)/(tabs)/${TAB_ROUTE_FILE[item.id]}` as never)}
            >
              <Text style={styles.secondaryActionText}>
                {translatedOr(t, `navItem.${item.id}`, item.label)}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
      {financeLinks.length > 0 && (
        <View style={styles.group}>
          <Text style={styles.groupHeading}>
            {translatedOr(t, 'navGroup.money', NAV_GROUP_LABEL.money)}
          </Text>
          {financeLinks.map((item) => (
            <Pressable
              key={item.route}
              accessibilityRole="button"
              style={styles.secondaryAction}
              onPress={() => router.push(item.route)}
            >
              <Text style={styles.secondaryActionText}>
                {translatedOr(t, item.labelKey, item.label)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('security.signOutThisTitle')}
        style={styles.signOut}
        onPress={handleLogout}
      >
        <Text style={styles.signOutText}>{t('common.signOut')}</Text>
      </Pressable>
    </>
  );

  if (role === UserRole.SHOP_OWNER) return <CustomerHome menu={menu} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {t('dashboard.welcome', { name: user?.firstName ?? '' })}
        </Text>
        {/*
          Was a second English `Record<UserRole, string>` in this file. The
          catalogue's is the same shape in both languages, so a new role is a
          compile error there — which is how a private copy goes stale without
          anybody noticing. This screen rendered `DELIVERY_PERSON` before either
          existed.
        */}
        <Text style={styles.role}>{role ? t(`roles.${role}`) : ''}</Text>
      </View>

      <Pressable
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel={
          unread.total
            ? t('home.notificationsUnread', { count: unread.total })
            : t('home.notificationsNoneUnread')
        }
        onPress={() => router.push('/(protected)/(tabs)/notifications')}
      >
        <Text style={styles.actionText}>
          {unread.total
            ? t('home.notificationsUnread', { count: unread.total })
            : translatedOr(t, 'navItem.notifications', 'Notifications')}
        </Text>
      </Pressable>

      {groups.map(({ group, items }) => (
        <View key={group} style={styles.group}>
          <Text style={styles.groupHeading}>
            {translatedOr(t, `navGroup.${group}`, NAV_GROUP_LABEL[group])}
          </Text>
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              style={styles.secondaryAction}
              onPress={() => router.push(`/(protected)/(tabs)/${TAB_ROUTE_FILE[item.id]}` as never)}
            >
              <Text style={styles.secondaryActionText}>
                {translatedOr(t, `navItem.${item.id}`, item.label)}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}

      {/* Finance destinations that live outside the tab group. */}
      {financeLinks.length > 0 && (
        <View style={styles.group}>
          <Text style={styles.groupHeading}>
            {translatedOr(t, 'navGroup.money', NAV_GROUP_LABEL.money)}
          </Text>
          {financeLinks.map((item) => (
            <Pressable
              key={item.route}
              accessibilityRole="button"
              style={styles.secondaryAction}
              onPress={() => router.push(item.route)}
            >
              <Text style={styles.secondaryActionText}>
                {translatedOr(t, item.labelKey, item.label)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('security.signOutThisTitle')}
        style={styles.signOut}
        onPress={handleLogout}
      >
        <Text style={styles.signOutText}>{t('common.signOut')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.canvas },
  content: { padding: layout.space[4], gap: layout.space[3] },
  header: { gap: layout.space[1], marginBottom: layout.space[2] },
  greeting: { fontSize: layout.fontSize['2xl'], fontWeight: '600', color: colour.text },
  role: { fontSize: layout.fontSize.sm, color: colour.textMuted },
  group: { gap: layout.space[2] },
  groupHeading: {
    fontSize: layout.fontSize.xs,
    fontWeight: '600',
    color: colour.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  // Every pressable clears the tap-target floor: these are used one-handed,
  // standing at a shop counter, sometimes in gloves.
  action: {
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: layout.space[4],
    borderRadius: layout.radius.md,
    backgroundColor: colour.brand,
  },
  actionText: { color: colour.onBrand, fontWeight: '600', fontSize: layout.fontSize.base },
  secondaryAction: {
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
    paddingHorizontal: layout.space[4],
    borderRadius: layout.radius.md,
    borderWidth: 1,
    borderColor: colour.border,
    backgroundColor: colour.surface,
  },
  secondaryActionText: { color: colour.text, fontWeight: '600', fontSize: layout.fontSize.base },
  signOut: {
    minHeight: layout.minTapTarget,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: layout.space[4],
    borderRadius: layout.radius.md,
    borderWidth: 1,
    borderColor: colour.danger,
  },
  signOutText: { color: colour.danger, fontWeight: '600', fontSize: layout.fontSize.base },
});
