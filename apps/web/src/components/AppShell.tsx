import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  NAV_GROUP_LABEL,
  NAV_BY_ID,
  breadcrumbFor,
  navItemsFor,
  type NavGroup,
  type NavItem,
} from '@medsupply/navigation';
import { UserRole } from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';
import { signOut } from '../api/client';
import { connectRealtime, disconnectRealtime } from '../realtime/socket';
import { NotificationBell } from './NotificationBell';
import { Toaster } from './ui/toast';
import { applyTheme, storedTheme, setTheme, type ThemeChoice } from '../lib/theme';
import { useBranding } from '../lib/useBranding';
import { routeIdForPath } from '../app/routes';

/**
 * The authenticated chrome.
 *
 * Before this, the entire persistent navigation was a three-item utility bar —
 * a wordmark, an "Activity" link and a bell — not filtered by role, so every
 * move between sections went back through the dashboard tile grid. There were
 * no breadcrumbs, no back, no indication of where you were, and no search. A
 * warehouse picker moving between the pick list and stock passed through the
 * home screen each time.
 *
 * `ProtectedRoute` split in two: this owns everything about being signed in,
 * and `RoleGate` owns the twelve lines that decide whether this particular
 * person may see this particular page.
 */

const GROUP_ORDER: NavGroup[] = [
  'work',
  'catalogue',
  'money',
  'insight',
  'administration',
  'account',
];

export function AppShell() {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();
  const branding = useBranding();
  const [theme, setThemeChoice] = useState<ThemeChoice>(() => storedTheme());
  const [navOpen, setNavOpen] = useState(false);

  // One realtime connection for the whole authenticated session, not one per
  // guarded route group — the old arrangement opened and closed a socket every
  // time the user crossed from one permission block to another.
  useEffect(() => {
    if (!isAuthenticated) return;
    connectRealtime();
    return () => disconnectRealtime();
  }, [isAuthenticated]);

  // The sidebar is a sheet on small screens; leaving it open across a
  // navigation would cover the page the user just asked for.
  useEffect(() => setNavOpen(false), [location.pathname]);

  const items = useMemo(() => (user ? navItemsFor(user.role as UserRole) : []), [user]);

  if (!isAuthenticated || !user) return <Navigate to="/login" replace />;

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);

  return (
    <div data-test="app-shell" className="min-h-screen bg-canvas text-text">
      <a href="#main" className="skip-link">
        Skip to the main content
      </a>

      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <button
          type="button"
          onClick={() => setNavOpen((open) => !open)}
          aria-expanded={navOpen}
          aria-controls="app-sidebar"
          className="min-h-11 rounded-md border border-border px-3 lg:hidden"
        >
          Menu
        </button>

        <Link to="/dashboard" className="text-lg font-semibold text-brand">
          {branding.name}
        </Link>

        <NavigationSearch items={items} />

        <div className="ms-auto flex items-center gap-2">
          <NotificationBell />
          <AccountMenu
            name={`${user.firstName} ${user.lastName}`}
            role={user.role as UserRole}
            theme={theme}
            onTheme={(next) => {
              setTheme(next);
              setThemeChoice(next);
            }}
          />
        </div>
      </header>

      <div className="flex">
        <nav
          id="app-sidebar"
          data-test="app-sidebar"
          aria-label="Sections"
          className={[
            'w-64 shrink-0 border-e border-border bg-surface p-3',
            'lg:block lg:sticky lg:top-[3.25rem] lg:h-[calc(100vh-3.25rem)] lg:overflow-y-auto',
            navOpen ? 'block fixed inset-y-0 start-0 z-[100] overflow-y-auto' : 'hidden',
          ].join(' ')}
        >
          {grouped.map(({ group, items: groupItems }) => (
            <div key={group} className="mb-4">
              <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                {NAV_GROUP_LABEL[group]}
              </h2>
              <ul className="flex flex-col gap-0.5">
                {groupItems.map((item) => (
                  <li key={item.id}>
                    <NavLink
                      to={item.path}
                      end={item.path === '/dashboard'}
                      className={({ isActive }) =>
                        [
                          'flex min-h-11 items-center rounded-md px-3 text-sm',
                          isActive
                            ? 'bg-brand-subtle font-semibold text-brand'
                            : 'text-text hover:bg-surface-hover',
                        ].join(' ')
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <main id="main" className="min-w-0 flex-1 px-4 py-6">
          <Breadcrumbs />
          <Outlet />
        </main>
      </div>

      <Toaster />
    </div>
  );
}

/**
 * The trail to here.
 *
 * The route id comes from matching the manifest, so the parent chain comes
 * from the manifest too — `/shops/:shopId/ledger` sits under Shops,
 * which no amount of path-prefix arithmetic would work out.
 */
function Breadcrumbs() {
  const { pathname } = useLocation();
  const routeId = routeIdForPath(pathname);
  if (!routeId) return null;

  const trail = breadcrumbFor(routeId);
  if (trail.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-text-muted">
        {trail.map((item, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={item.id} className="flex items-center gap-1">
              {index > 0 && <span aria-hidden="true">/</span>}
              {last ? (
                <span aria-current="page" className="text-text">
                  {item.label}
                </span>
              ) : (
                <Link to={item.path} className="underline underline-offset-2">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Navigation search, built from the manifest at module load and filtered by
 * role — no API call, so it answers instantly and works offline. Entity search
 * by reference is a deliberately separate second tier, arriving with phase 4:
 * mixing the two would make an empty entity result look like a broken
 * navigator.
 */
function NavigationSearch({ items }: { items: NavItem[] }) {
  const [query, setQuery] = useState('');
  const matches = query.trim()
    ? items.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  return (
    <div className="relative hidden md:block">
      <label htmlFor="app-search" className="sr-only">
        Search sections
      </label>
      <input
        id="app-search"
        data-test="app-search"
        type="search"
        value={query}
        placeholder="Go to…"
        onChange={(event) => setQuery(event.target.value)}
        className="min-h-11 w-64 rounded-md border border-border bg-surface px-3 text-sm"
      />
      {matches.length > 0 && (
        <ul className="absolute z-[100] mt-1 w-64 rounded-md border border-border bg-surface shadow-lg">
          {matches.slice(0, 8).map((item) => (
            <li key={item.id}>
              <Link
                to={item.path}
                onClick={() => setQuery('')}
                className="flex min-h-11 items-center px-3 text-sm hover:bg-surface-hover"
              >
                {item.label}
                <span className="ms-auto text-xs text-text-muted">
                  {NAV_GROUP_LABEL[item.group]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<UserRole, string> = {
  [UserRole.SUPER_ADMIN]: 'Super administrator',
  [UserRole.ADMIN]: 'Administrator',
  [UserRole.MANAGER]: 'Manager',
  [UserRole.STOREKEEPER]: 'Storekeeper',
  [UserRole.DELIVERY_PERSON]: 'Delivery person',
  [UserRole.SHOP_OWNER]: 'Shop owner',
};

function AccountMenu({
  name,
  role,
  theme,
  onTheme,
}: {
  name: string;
  role: UserRole;
  theme: ThemeChoice;
  onTheme: (choice: ThemeChoice) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-test="app-account-menu"
          className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm"
        >
          <span className="max-w-32 truncate">{name}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[200] min-w-56 rounded-md border border-border bg-surface p-1 shadow-lg"
        >
          <DropdownMenu.Label className="px-3 py-2 text-xs text-text-muted">
            {/* The role in words. `dashboard.tsx` on mobile showed the raw enum. */}
            {ROLE_LABEL[role]}
          </DropdownMenu.Label>
          <DropdownMenu.Item asChild>
            <Link
              to={NAV_BY_ID.security.path}
              className="flex min-h-11 items-center rounded px-3 text-sm hover:bg-surface-hover"
            >
              Sign-in and security
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Label className="px-3 py-1 text-xs text-text-muted">
            Appearance
          </DropdownMenu.Label>
          {(['light', 'dark', 'system'] as const).map((choice) => (
            <DropdownMenu.CheckboxItem
              key={choice}
              checked={theme === choice}
              onCheckedChange={() => onTheme(choice)}
              className="flex min-h-11 items-center rounded px-3 text-sm capitalize hover:bg-surface-hover"
            >
              {choice}
              {theme === choice && <span className="ms-auto">✓</span>}
            </DropdownMenu.CheckboxItem>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => void signOut()}
            className="flex min-h-11 items-center rounded px-3 text-sm text-danger hover:bg-surface-hover"
          >
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Applied before React paints, so the theme never flashes. */
applyTheme(storedTheme());
