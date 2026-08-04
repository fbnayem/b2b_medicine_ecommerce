import { useCallback, useEffect, useState } from 'react';
import { Text, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { RealtimeEvent, UserRole, type UnreadNotificationSummary } from '@medsupply/shared-types';
import { NAV_GROUP_LABEL, navItemsFor } from '@medsupply/navigation';
import { useAuthStore } from '../../../src/store/useAuth';
import { getFinanceNavigation } from '../../../src/finance/navigation';
import { fetchUnreadSummary } from '../../../src/notifications/api';
import { disconnectRealtime, onRealtime } from '../../../src/notifications/realtime';
import { unregisterCurrentDevice } from '../../../src/notifications/push';
import { TAB_ROUTE_FILE } from '../../../src/navigation/tabs';
import { colour, layout } from '../../../src/theme';
import { useLanguage } from '../../../src/i18n/useLanguage';

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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Welcome, {user?.firstName}</Text>
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
          unread.total ? `Notifications, ${unread.total} unread` : 'Notifications, none unread'
        }
        onPress={() => router.push('/(protected)/(tabs)/notifications')}
      >
        <Text style={styles.actionText}>
          Notifications{unread.total ? ` (${unread.total})` : ''}
        </Text>
      </Pressable>

      {groups.map(({ group, items }) => (
        <View key={group} style={styles.group}>
          <Text style={styles.groupHeading}>{NAV_GROUP_LABEL[group]}</Text>
          {items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              style={styles.secondaryAction}
              onPress={() => router.push(`/(protected)/(tabs)/${TAB_ROUTE_FILE[item.id]}` as never)}
            >
              <Text style={styles.secondaryActionText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      ))}

      {/* Finance destinations that live outside the tab group. */}
      {financeLinks.length > 0 && (
        <View style={styles.group}>
          <Text style={styles.groupHeading}>Money</Text>
          {financeLinks.map((item) => (
            <Pressable
              key={item.route}
              accessibilityRole="button"
              style={styles.secondaryAction}
              onPress={() => router.push(item.route)}
            >
              <Text style={styles.secondaryActionText}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out of this device"
        style={styles.signOut}
        onPress={handleLogout}
      >
        <Text style={styles.signOutText}>Sign out</Text>
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
