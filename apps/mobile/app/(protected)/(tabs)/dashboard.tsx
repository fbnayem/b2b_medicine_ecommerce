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
   * A shop owner opens this to ask three questions — what do I owe, what is
   * coming, and can I have that again — and got a list of buttons instead. The
   * menu is still needed, so it is handed to `CustomerHome` and rendered under
   * the summary rather than replaced.
   *
   * Only the Shop application ever takes that branch, because a build admits
   * one set of roles.
   *
   * **No sign-out in here any more.** It used to live at the bottom of this
   * screen because there was nowhere else to put it; a shop owner now has an
   * account menu, and two sign-out buttons two taps apart is a question about
   * whether they do the same thing.
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

      {/*
        The same menu the Shop application renders under its summary. It was
        written out twice in this file, so a destination added to one branch
        was invisible to the other half of the roles.
      */}
      {menu}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('security.signOutThisTitle')}
        style={styles.signOut}
        onPress={() => void leaveSession()}
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
