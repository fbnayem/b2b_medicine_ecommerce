import { Tabs } from 'expo-router/js-tabs';
import { UserRole } from '@medsupply/shared-types';
import { useAuthStore } from '../../../src/store/useAuth';
import { ALL_TAB_FILES, tabsFor } from '../../../src/navigation/tabs';
import { colour, layout } from '../../../src/theme';
import { useLanguage } from '../../../src/i18n/useLanguage';

/**
 * The per-role bottom tab bar `AGENTS.md` has specified since the first phase.
 *
 * There was none. Mobile had a single `Stack` of thirty screens and a vertical
 * list of buttons on the dashboard, so a delivery rider looking for today's
 * deliveries went home, scrolled, and tapped — every time, one-handed, often
 * standing at a shop counter.
 *
 * `import { Tabs } from 'expo-router'` is **deprecated in SDK 57**; the current
 * import is `expo-router/js-tabs`.
 *
 * One tab group serves all six roles rather than six layouts. Every screen that
 * is a tab for anybody is declared here, and `href: null` removes it from the
 * bar for the roles it is not a tab for — those roles can still reach it by
 * pushing, which is what makes `returns` a tab for a storekeeper and an
 * ordinary screen for a manager.
 */
export default function TabsLayout() {
  const { t } = useLanguage();
  const role = useAuthStore((state) => state.user?.role) as UserRole | undefined;
  const active = role ? tabsFor(role, t) : [];
  const activeNames = new Set(active.map((tab) => tab.name));

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colour.brand,
        tabBarInactiveTintColor: colour.textMuted,
        tabBarStyle: {
          backgroundColor: colour.surface,
          borderTopColor: colour.border,
          // A tab bar shorter than this is a tab bar that gets mis-tapped by
          // somebody holding a parcel in the other hand.
          minHeight: layout.minTapTarget + layout.space[3],
        },
        headerStyle: { backgroundColor: colour.surface },
        headerTintColor: colour.text,
      }}
    >
      {ALL_TAB_FILES.map((name) => {
        const tab = active.find((entry) => entry.name === name);
        return (
          <Tabs.Screen
            key={name}
            name={name}
            options={{
              title: tab?.title ?? name,
              // Present for everyone, in the bar only for the roles it belongs to.
              href: activeNames.has(name) ? undefined : null,
            }}
          />
        );
      })}
    </Tabs>
  );
}
