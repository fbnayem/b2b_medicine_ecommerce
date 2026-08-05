import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  ChevronDown,
  ChevronRight,
  Menu as MenuIcon,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react';
import {
  NAV_GROUP_LABEL,
  NAV_BY_ID,
  breadcrumbFor,
  navItemsFor,
  type NavGroup,
  type NavItem,
} from '@medsupply/navigation';
import { UserRole } from '@medsupply/shared-types';
import { translatedOr, type Language } from '@medsupply/i18n';
import { useAuthStore } from '../store/useAuth';
import { signOut } from '../api/client';
import { connectRealtime, disconnectRealtime } from '../realtime/socket';
import { useLiveCache } from '../realtime/useLiveCache';
import { NotificationBell } from './NotificationBell';
import { Toaster } from './ui/toast';
import { AskProvider } from './ui/ask';
import { RouteAnnouncer } from './RouteAnnouncer';
import { useLanguage } from '../lib/useLanguage';
import { LANGUAGE_LABEL, LANGUAGES } from '@medsupply/i18n';
import { applyTheme, storedTheme, setTheme, type ThemeChoice } from '../lib/theme';
import { useBranding } from '../lib/useBranding';
import { routeIdForPath } from '../app/routes';
import { NAV_ICON } from './navIcons';
import { useCollapsedGroups, useRail } from '../lib/sidebarState';

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
  'purchasing',
  'money',
  'insight',
  'administration',
  'account',
];

export function AppShell() {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();
  const branding = useBranding();
  const { t, language, setLanguage } = useLanguage();
  const [theme, setThemeChoice] = useState<ThemeChoice>(() => storedTheme());
  const [navOpen, setNavOpen] = useState(false);
  const { rail, toggle: toggleRail } = useRail();

  // One realtime connection for the whole authenticated session, not one per
  // guarded route group — the old arrangement opened and closed a socket every
  // time the user crossed from one permission block to another.
  useEffect(() => {
    if (!isAuthenticated) return;
    connectRealtime();
    return () => disconnectRealtime();
  }, [isAuthenticated]);

  // What each push makes stale, decided in one place rather than per page.
  useLiveCache();

  // The sidebar is a sheet on small screens; leaving it open across a
  // navigation would cover the page the user just asked for.
  useEffect(() => setNavOpen(false), [location.pathname]);

  const items = useMemo(() => (user ? navItemsFor(user.role as UserRole) : []), [user]);

  if (!isAuthenticated || !user) return <Navigate to="/login" replace />;

  /*
   * A user carrying `forcePasswordChange` goes to one screen and stays there.
   *
   * The server refuses every other endpoint with `PASSWORD_CHANGE_REQUIRED`, so
   * without this they would reach a page that renders nothing but errors and
   * would have no way of knowing why. The flag was previously advisory text on
   * the sign-in response and nothing else — the temporary password an
   * administrator issued never expired and was never replaced.
   */
  if (user.forcePasswordChange && location.pathname !== NAV_BY_ID['change-password'].path) {
    return <Navigate to={NAV_BY_ID['change-password'].path} replace />;
  }

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);

  return (
    <AskProvider>
      {/*
        The header's height, declared once on the shell so the header and the
        sidebar's sticky offset read the same value. It was written out as
        `3.25rem` in two separate class names, and a change to the header's
        padding left the sidebar either short of the viewport or scrolling
        behind it, with nothing to connect cause to effect.
      */}
      <div
        data-test="app-shell"
        style={{ ['--header-h' as string]: '3.25rem' }}
        className="min-h-screen bg-canvas text-text"
      >
        <a href="#main" className="skip-link">
          {t('nav.skipToContent')}
        </a>
        <RouteAnnouncer />

        <header className="sticky top-0 z-10 flex h-[var(--header-h)] items-center gap-3 border-b border-border bg-surface px-4">
          <button
            type="button"
            onClick={() => setNavOpen((open) => !open)}
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
            aria-label={t('nav.sections')}
            className="flex size-11 items-center justify-center rounded-md border border-border lg:hidden"
          >
            {/* Was the literal word "Menu", untranslated, on the one control a
                phone user needs before they can reach anything else. */}
            <MenuIcon aria-hidden="true" size={20} />
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
              language={language}
              onLanguage={setLanguage}
            />
          </div>
        </header>

        <div className="flex">
          <Sidebar groups={grouped} open={navOpen} rail={rail} onRail={toggleRail} />

          {/*
            `tabIndex={-1}` so `RouteAnnouncer` can move focus here after a
            navigation without adding another stop to the tab order.
          */}
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6">
            {/*
              An inner width limit, not one on `<main>` itself.

              Every authenticated page ran the full width of the window, so on a
              1920px monitor a two-column detail card is around 880px wide and a
              label and its value sit the better part of a metre apart. That is
              the loudest "unfinished" signal in the product and it applies to
              all forty-three screens.

              Inner, because `<main>` carries the print rule that zeroes its
              padding and the `tabIndex={-1}` focus target — neither should have
              to know about a layout constraint. And 100rem rather than
              something tighter, because the batch table on the stock screen has
              nine columns and a narrower page would put it back into a
              horizontal scroll.
            */}
            <div className="mx-auto w-full max-w-[100rem]">
              <Breadcrumbs />
              <Outlet />
            </div>
          </main>
        </div>

        <Toaster />
      </div>
    </AskProvider>
  );
}

interface SidebarGroup {
  group: NavGroup;
  items: NavItem[];
}

/**
 * The navigation.
 *
 * Three things changed, and each one addresses the same complaint: a super
 * admin is offered thirty-seven destinations and the list simply scrolled.
 *
 * **Icons.** `NavItem.icon` has been in `@medsupply/navigation` since the shell
 * was built and the web has never read it, so every row was identical text and
 * finding one meant reading the lot. They are `aria-hidden`: the accessible
 * name of each link must stay exactly its label, because six end-to-end specs
 * match on `getByRole('link', { name, exact: true })` — an icon that
 * contributed a word to that name would break all of them, which is precisely
 * why it is worth saying out loud here.
 *
 * **Collapsible groups**, remembered. The group holding the current page is
 * always open regardless of what was stored, so a collapse can never hide the
 * page somebody is looking at.
 *
 * **A rail.** Collapsed to icons for people who know where things are, with the
 * label in a tooltip for the moment they do not.
 */
function Sidebar({
  groups,
  open,
  rail,
  onRail,
}: {
  groups: SidebarGroup[];
  open: boolean;
  rail: boolean;
  onRail: () => void;
}) {
  const { t } = useLanguage();
  const { pathname } = useLocation();
  const { collapsed, toggle } = useCollapsedGroups();

  const holdsCurrentPage = (items: NavItem[]) =>
    items.some((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));

  return (
    <nav
      id="app-sidebar"
      data-test="app-sidebar"
      aria-label={t('nav.sections')}
      className={[
        'shrink-0 border-e border-border bg-surface p-2',
        rail ? 'lg:w-16' : 'w-64',
        // `--header-h` is published by the header itself, so this no longer
        // guesses at 3.25rem in two places and drift silently.
        'lg:block lg:sticky lg:top-[var(--header-h)] lg:h-[calc(100vh-var(--header-h))] lg:overflow-y-auto',
        open ? 'block fixed inset-y-0 start-0 z-[100] w-64 overflow-y-auto' : 'hidden',
      ].join(' ')}
    >
      <Tooltip.Provider delayDuration={200}>
        {groups.map(({ group, items }) => {
          const current = holdsCurrentPage(items);
          const shut = !rail && collapsed.includes(group) && !current;
          const label = translatedOr(t, `navGroup.${group}`, NAV_GROUP_LABEL[group]);
          return (
            <div key={group} className="mb-2">
              {rail ? (
                <hr className="my-2 border-border first:hidden" />
              ) : (
                <h2>
                  <button
                    type="button"
                    onClick={() => toggle(group)}
                    aria-expanded={!shut}
                    className={[
                      'flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-start',
                      'text-xs font-semibold uppercase tracking-wide hover:bg-surface-hover',
                      // The heading says which section you are in, which is the
                      // one thing the old sidebar never indicated at all.
                      current ? 'text-brand' : 'text-text-muted',
                    ].join(' ')}
                  >
                    {shut ? (
                      <ChevronRight aria-hidden="true" size={14} />
                    ) : (
                      <ChevronDown aria-hidden="true" size={14} />
                    )}
                    {label}
                  </button>
                </h2>
              )}
              {!shut && (
                <ul className="flex flex-col gap-0.5">
                  {items.map((item) => {
                    const Icon = NAV_ICON[item.icon];
                    const words = translatedOr(t, `navItem.${item.id}`, item.label);
                    const link = (
                      <NavLink
                        to={item.path}
                        end={item.path === '/dashboard'}
                        className={({ isActive }) =>
                          [
                            'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm',
                            rail ? 'lg:justify-center lg:px-0' : '',
                            isActive
                              ? 'bg-brand-subtle font-semibold text-brand'
                              : 'text-text hover:bg-surface-hover',
                          ].join(' ')
                        }
                      >
                        <Icon aria-hidden="true" size={18} className="shrink-0" />
                        <span className={rail ? 'lg:sr-only' : ''}>{words}</span>
                      </NavLink>
                    );
                    return (
                      <li key={item.id}>
                        {rail ? (
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Content
                                side="right"
                                sideOffset={8}
                                className="z-[200] rounded-md border border-border bg-surface px-2 py-1 text-sm text-text shadow-md"
                              >
                                {words}
                              </Tooltip.Content>
                            </Tooltip.Portal>
                          </Tooltip.Root>
                        ) : (
                          link
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </Tooltip.Provider>

      {/* Wide screens only: on a phone the sidebar is already a sheet. */}
      <button
        type="button"
        onClick={onRail}
        aria-pressed={rail}
        className="mt-2 hidden min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm text-text-muted hover:bg-surface-hover lg:flex"
      >
        {rail ? (
          <PanelLeft aria-hidden="true" size={18} className="shrink-0" />
        ) : (
          <PanelLeftClose aria-hidden="true" size={18} className="shrink-0" />
        )}
        <span className={rail ? 'sr-only' : ''}>{t('nav.collapseSidebar')}</span>
      </button>
    </nav>
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
  // Both hooks before the early returns: this component bails out on a route
  // with no manifest entry, and a hook after that point runs on some renders
  // and not others.
  const { pathname } = useLocation();
  const { t } = useLanguage();

  const routeId = routeIdForPath(pathname);
  if (!routeId) return null;

  const trail = breadcrumbFor(routeId);
  if (trail.length <= 1) return null;

  return (
    <nav
      // A stable id as well as the label. `navigation.spec.ts` matched on
      // `getByRole('navigation', { name: 'Breadcrumb' })` and has been failing
      // since this label started coming from the catalogue — it reads "Where
      // you are" in English and something else again in Bangla.
      // `docs/TESTING.md` bans `getByText` for translatable strings for exactly
      // this reason, and an accessible name built from one is the same thing.
      data-test="breadcrumb"
      aria-label={t('nav.breadcrumb')}
      className="mb-3"
    >
      <ol className="flex flex-wrap items-center gap-1 text-sm text-text-muted">
        {trail.map((item, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={item.id} className="flex items-center gap-1">
              {index > 0 && <span aria-hidden="true">/</span>}
              {last ? (
                <span aria-current="page" className="text-text">
                  {translatedOr(t, `navItem.${item.id}`, item.label)}
                </span>
              ) : (
                <Link to={item.path} className="underline underline-offset-2">
                  {translatedOr(t, `navItem.${item.id}`, item.label)}
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
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const matches = query.trim()
    ? items.filter((item) =>
        // Searched on the label the person can actually see, so typing "ফেরত"
        // finds Returns when the app is in Bangla.
        translatedOr(t, `navItem.${item.id}`, item.label)
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : [];

  return (
    <div className="relative hidden md:block">
      <label htmlFor="app-search" className="sr-only">
        {t('nav.searchSections')}
      </label>
      <input
        id="app-search"
        data-test="app-search"
        type="search"
        value={query}
        placeholder={t('nav.goTo')}
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
                {translatedOr(t, `navItem.${item.id}`, item.label)}
                <span className="ms-auto text-xs text-text-muted">
                  {translatedOr(t, `navGroup.${item.group}`, NAV_GROUP_LABEL[item.group])}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountMenu({
  name,
  role,
  theme,
  onTheme,
  language,
  onLanguage,
}: {
  name: string;
  role: UserRole;
  theme: ThemeChoice;
  onTheme: (choice: ThemeChoice) => void;
  language: Language;
  onLanguage: (next: Language) => void;
}) {
  const { t, c } = useLanguage();
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
            {/*
              Was `c.roles[role] ?? ROLE_LABEL[role]`, with `ROLE_LABEL` a
              second English copy of the same map living in this file. The
              catalogue's is `Record<UserRole, string>` in both languages, so a
              new role is a compile error there — which is exactly how the
              fallback would have gone stale without anybody noticing.
            */}
            {c.roles[role]}
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
            {t('nav.language')}
          </DropdownMenu.Label>
          {LANGUAGES.map((option) => (
            <DropdownMenu.CheckboxItem
              key={option}
              checked={language === option}
              onCheckedChange={() => onLanguage(option)}
              className="flex min-h-11 items-center rounded px-3 text-sm hover:bg-surface-hover"
            >
              {/* Each language in its own script, so somebody who cannot read
                  the current one can still find theirs. */}
              {LANGUAGE_LABEL[option]}
              {language === option && <span className="ms-auto">✓</span>}
            </DropdownMenu.CheckboxItem>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Label className="px-3 py-1 text-xs text-text-muted">
            {t('nav.appearance')}
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
            {t('common.signOut')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Applied before React paints, so the theme never flashes. */
applyTheme(storedTheme());
