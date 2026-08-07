import { useCallback, useEffect, useState } from 'react';
import { Text, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { RealtimeEvent, UserRole, type UnreadNotificationSummary } from '@medsupply/shared-types';
import { NAV_GROUP_LABEL } from '@medsupply/navigation';
import { translatedOr } from '@medsupply/i18n';
import { useAuthStore } from '../../../src/store/useAuth';
import { leaveSession } from '../../../src/store/leave';
import { getFinanceNavigation } from '../../../src/finance/navigation';
import { fetchUnreadSummary } from '../../../src/notifications/api';
import { onRealtime } from '../../../src/notifications/realtime';
import { MOBILE_ROUTE, destinationsFor } from '../../../src/navigation/routes';
import { colour, layout } from '../../../src/theme';
import { useLanguage } from '../../../src/i18n/useLanguage';
import { CustomerHome } from '../../../src/home/CustomerHome';
import { RiderHome } from '../../../src/home/RiderHome';
import { StaffHome } from '../../../src/home/StaffHome';

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
  const user = useAuthStore((state) => state.user);
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

  const role = user?.role as UserRole | undefined;
  /*
   * Everything this role may open, not everything that happens to be a tab.
   *
   * This filtered through `TAB_ROUTE_FILE` — the seventeen files that are a tab
   * for *somebody* — so the menu could only offer a destination that was a tab,
   * and every screen reached by pushing was invisible. A manager permitted 35
   * destinations was shown 13, a storekeeper 8 of 16. `src/navigation/routes.ts`
   * carries the reasoning and the list of what is still missing.
   */
  const destinations = role ? destinationsFor(role) : [];
  const financeLinks = getFinanceNavigation(role);

  const groups = GROUPS.map((group) => ({
    group,
    items: destinations.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);

  /*
   * A shop owner signs out from their account screen, which is where anybody
   * looks for it — two sign-out buttons two taps apart is a question about
   * whether they do the same thing. Staff and riders have no such screen, so
   * the button stays here, shared by both branches, calling the sequence that
   * unregisters the push token while the credential authorising it is still
   * valid.
   */
  const signOut = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('security.signOutThisTitle')}
      style={styles.signOut}
      onPress={() => void leaveSession()}
    >
      <Text style={styles.signOutText}>{t('common.signOut')}</Text>
    </Pressable>
  );

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
              onPress={() => router.push(MOBILE_ROUTE[item.id] as never)}
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
    </>
  );

  const withSignOut = (
    <>
      {menu}
      {signOut}
    </>
  );

  /*
   * Three applications, three homes, one menu.
   *
   * The rider's branch used to be the plain list, defended on the grounds that
   * their five tabs already carried the whole of their day. The tabs carry the
   * *lists*: they do not say where the next stop is, how much cash is in the
   * bag, or what this handset has failed to send. `RiderHome` answers those
   * three, and it is the same argument that removed the signpost for a pharmacy
   * in Phase 37 and for staff in Phase 39.
   */
  if (role === UserRole.SHOP_OWNER) return <CustomerHome menu={menu} />;
  if (role === UserRole.DELIVERY_PERSON) return <RiderHome menu={withSignOut} />;
  if (role) return <StaffHome role={role} menu={withSignOut} />;

  /*
   * No role yet — the moment between a session restoring and the profile
   * arriving. The menu is empty because it is built from the role, so this is
   * the notifications button and nothing else, which is honest about how much
   * is known.
   */
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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
      {signOut}
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
