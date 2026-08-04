import { Link } from 'react-router-dom';
import { navItemsFor, type NavGroup } from '@medsupply/navigation';
import type { UserRole } from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';
import { useBranding } from '../lib/useBranding';
import { Card, PageHeader } from '../components/ui';
import { useLanguage } from '../lib/useLanguage';

/**
 * The home screen, generated from the same manifest as the sidebar.
 *
 * It used to hand-write a tile per role — 139 lines of `<Link>` elements behind
 * `canManageFinance` and `isAdministrator` booleans — which made it the third
 * copy of the permission matrix, after `App.tsx` and mobile's guards. A tile
 * could therefore be offered to somebody the router would refuse, or withheld
 * from somebody entitled to it, and nothing would notice — and because the tile
 * grid was also the only navigation there was, a missing tile meant a screen
 * you simply could not reach.
 *
 * The descriptions are the one thing the manifest cannot supply, because they
 * are written for a reader rather than for a menu — they live in the
 * translation catalogue, keyed by the same route id.
 *
 * The tile *titles* come from `@medsupply/navigation`, which mobile shares.
 * They are English in both languages today; translating them belongs with that
 * package so the two clients cannot end up with different words for the same
 * screen.
 */

const GROUP_ORDER: NavGroup[] = [
  'work',
  'catalogue',
  'money',
  'insight',
  'administration',
  'account',
];

export function Dashboard() {
  const { t } = useLanguage();
  const user = useAuthStore((state) => state.user);
  const branding = useBranding();
  if (!user) return null;

  const items = navItemsFor(user.role as UserRole).filter((item) => item.id !== 'dashboard');
  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);

  return (
    <>
      <PageHeader
        routeId="dashboard"
        title={t('dashboard.welcome', { name: user.firstName })}
        description={t('dashboard.subtitle', { business: branding.name })}
      />

      {groups.map(({ group, items: groupItems }) => (
        <section key={group} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
            {t(`dashboard.group${group.charAt(0).toUpperCase()}${group.slice(1)}`)}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {groupItems.map((item) => (
              <Card key={item.id} className="p-0">
                <Link
                  to={item.path}
                  className="flex h-full flex-col gap-1 rounded-lg p-4 hover:bg-surface-hover"
                >
                  <span className="text-lg font-semibold text-text">{item.label}</span>
                  {/*
                    `t()` returns the key when it has no entry, which would put
                    "purpose.checkout" on a tile. Not every navigable screen
                    needs a sentence, so a missing one renders nothing.
                  */}
                  {t(`purpose.${item.id}`) !== `purpose.${item.id}` && (
                    <span className="text-sm text-text-muted">{t(`purpose.${item.id}`)}</span>
                  )}
                </Link>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
