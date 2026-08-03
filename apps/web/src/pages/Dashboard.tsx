import { Link } from 'react-router-dom';
import { NAV_GROUP_LABEL, navItemsFor, type NavGroup } from '@medsupply/navigation';
import type { UserRole } from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';
import { useBranding } from '../lib/useBranding';
import { Card, PageHeader } from '../components/ui';

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
 * are written for a reader rather than for a menu.
 */

/** What each section is *for*, in the words of the person who uses it. */
const PURPOSE: Record<string, string> = {
  orders: 'Track what has been ordered and where each order has reached.',
  approvals: 'Orders waiting for a decision on price, quantity and credit.',
  fulfilment: 'Pick lists waiting to be worked, and the ones in progress.',
  'fulfilment-ready': 'Packed orders waiting to be handed to a rider.',
  deliveries: 'Who is carrying what, and what has arrived.',
  returns: 'Goods coming back, and the credit notes raised against them.',
  medicines: 'The catalogue: what is sold, and at what price.',
  inventory: 'Batches on hand, what is reserved, and what is near expiry.',
  cart: 'The order you are putting together.',
  payments: 'Record, post, inspect and reverse customer payments.',
  collections: 'Cash riders have collected, waiting to be checked in.',
  'report-outstanding': 'What every shop owes today.',
  'report-overdue': 'What is past its due date, and by how long.',
  'report-collections': 'What has been collected, by whom, over a period.',
  analytics: 'Sales, stock and receivables at a glance.',
  'analytics-sales': 'What has been bought and returned over time.',
  'analytics-returns': 'What is coming back, and why.',
  'analytics-inventory': 'Stock cover, movement and expiry risk.',
  'analytics-deliveries': 'How deliveries are performing.',
  'analytics-receivables': 'How the debt is ageing.',
  shops: 'Customers, their credit terms and their licences.',
  users: 'People who can sign in, and what each of them may do.',
  settings: 'Tax, credit, expiry windows, notifications and branding.',
  audit: 'Every privileged action, who took it and when.',
  'shop-account': 'What you owe, what credit you have left, and your invoices.',
  'my-payments': 'Payments recorded against your account.',
  'my-statement': 'Your account, period by period.',
  notifications: 'Everything the system has told you.',
  activity: 'What has happened recently, across the business.',
  security: 'Where you are signed in, and how to sign out elsewhere.',
};

const GROUP_ORDER: NavGroup[] = [
  'work',
  'catalogue',
  'money',
  'insight',
  'administration',
  'account',
];

export function Dashboard() {
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
        title={`Welcome back, ${user.firstName}`}
        description={`Everything you can do in ${branding.name}, grouped by what it is for.`}
      />

      {groups.map(({ group, items: groupItems }) => (
        <section key={group} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
            {NAV_GROUP_LABEL[group]}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {groupItems.map((item) => (
              <Card key={item.id} className="p-0">
                <Link
                  to={item.path}
                  className="flex h-full flex-col gap-1 rounded-lg p-4 hover:bg-surface-hover"
                >
                  <span className="text-lg font-semibold text-text">{item.label}</span>
                  {PURPOSE[item.id] && (
                    <span className="text-sm text-text-muted">{PURPOSE[item.id]}</span>
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
