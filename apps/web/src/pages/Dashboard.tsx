import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { navItemsFor, type NavGroup } from '@medsupply/navigation';
import type { UserRole } from '@medsupply/shared-types';
import { translatedOr } from '@medsupply/i18n';
import { useAuthStore } from '../store/useAuth';
import { useBranding } from '../lib/useBranding';
import { PageHeader } from '../components/ui';
import { NAV_ICON } from '../components/navIcons';
import { useApiCollection, useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatMinor } from '../lib/finance';
import {
  OWN_ACCOUNT,
  showsOwnAccount,
  showsTrade,
  signalsFor,
  type HomeSignal,
  type SignalIcon,
  type SignalTone,
} from '../lib/homeSignals';
import { HomeCharts } from '../components/HomeCharts';
import type { AccountSummary } from './financeTypes';

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
 * That fixed the correctness problem and left a design one. The screen was
 * twenty cards naming twenty destinations the sidebar names too, three
 * centimetres to the left, and **not one fact about the business**. Opening it
 * told a manager nothing they did not know before they opened it.
 *
 * So the numbers come first now, and the directory second. What is waiting for
 * this person is `lib/homeSignals.ts` — including why a delivery person sees
 * none of it, and why each figure reuses the query key of the screen it links
 * to rather than counting anything itself.
 *
 * The descriptions on the directory tiles are the one thing the manifest cannot
 * supply, because they are written for a reader rather than for a menu — they
 * live in the translation catalogue, keyed by the same route id.
 */

/**
 * Every group, in the order the sidebar shows them.
 *
 * `purchasing` was missing. It has been missing since this list was written, so
 * suppliers, purchase orders, the recall trace and the controlled register —
 * four screens a manager reaches from the sidebar every day — have never
 * appeared on the home screen at all. The type is `NavGroup[]`, which made the
 * omission invisible: leaving a member out of an array of a union is not an
 * error, it is just a shorter array. `dashboardGroups.test.ts` now counts them.
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

export const DASHBOARD_GROUPS: readonly NavGroup[] = GROUP_ORDER;

/**
 * One figure, with the words under it rather than over it.
 *
 * The number is the thing being read, so it is what the eye lands on; the label
 * explains a number already seen. Reversing those is how a wall of statistics
 * turns into a wall of captions.
 *
 * A signal that is loading or that failed renders **nothing at all**. This is
 * the first screen of the day and these are secondary figures: an error card
 * where a count should be would be a worse morning than a slightly shorter row,
 * and the destination behind it is one click away in the sidebar regardless.
 */
/**
 * The hue each stage of an order keeps, on the tile and in the chart.
 *
 * Tailwind cannot build a class name at runtime, so these are written out. The
 * pairs are the ones `tokenParity.test.ts` already holds to 4.5:1 against each
 * other in both themes — the tile is spending a palette that was already
 * proved, not inventing one.
 */
const TILE: Record<SignalTone, { tint: string; solid: string; ink: string; edge: string }> = {
  info: { tint: 'bg-info-subtle', solid: 'bg-info', ink: 'text-info', edge: 'border-info/40' },
  progress: {
    tint: 'bg-progress-subtle',
    solid: 'bg-progress',
    ink: 'text-progress',
    edge: 'border-progress/40',
  },
  warning: {
    tint: 'bg-warning-subtle',
    solid: 'bg-warning',
    ink: 'text-warning',
    edge: 'border-warning/40',
  },
  transit: {
    tint: 'bg-transit-subtle',
    solid: 'bg-transit',
    ink: 'text-transit',
    edge: 'border-transit/40',
  },
  brand: { tint: 'bg-brand-subtle', solid: 'bg-brand', ink: 'text-brand', edge: 'border-brand/40' },
};

/**
 * The hue each part of the menu keeps, matching the group headings in the
 * sidebar. Colour here is doing navigation work rather than decoration: the
 * money tiles and the money section of the sidebar are the same blue, so
 * "where was that screen" has an answer you can see before you can read.
 */
const GROUP_TONE: Record<NavGroup, string> = {
  work: 'text-brand',
  catalogue: 'text-progress',
  purchasing: 'text-warning',
  money: 'text-info',
  insight: 'text-transit',
  administration: 'text-text-muted',
  account: 'text-brand',
};

function Signal({
  value,
  label,
  path,
  id,
  nothing,
  tone,
  icon,
}: {
  value: string | undefined;
  label: string;
  path: string;
  id: string;
  /** True when the figure is zero, whatever zero looks like in this currency. */
  nothing: boolean;
  tone: SignalTone;
  icon: SignalIcon;
}) {
  if (value === undefined) return null;
  const skin = TILE[tone];
  const Icon = NAV_ICON[icon];

  return (
    <Link
      to={path}
      data-test={`signal-${id}`}
      className={clsx(
        'group flex h-full flex-col gap-3 rounded-panel border p-4 shadow-card',
        'transition-shadow hover:shadow-lifted',
        // A tile with nothing in it drops its tint as well as its weight, so a
        // row of them reads as "three quiet, one live" at a glance rather than
        // as four equally urgent squares.
        nothing ? 'border-border bg-surface' : `${skin.tint} ${skin.edge}`,
      )}
    >
      {/*
        A solid chip, not another wash of the same tint. The subtle tints in
        this palette sit a few percent off white by design — they are made to
        carry small text inside a badge — so a card background, an icon and a
        number all painted in them read as one pale smear. Full-strength tone
        behind the icon gives the hue somewhere to actually land.
      */}
      <span
        aria-hidden="true"
        className={clsx(
          'inline-flex size-9 items-center justify-center rounded-control',
          nothing ? 'bg-surface-sunken text-text-muted' : `${skin.solid} text-on-brand`,
        )}
      >
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <span className="flex flex-col gap-0.5">
        {/*
          A zero is quieter than a number. It is still shown — "nothing is
          stuck" is an answer, and a card that disappears when empty moves the
          three beside it and reads as a fault — but it should not compete for
          attention with the figure that needs somebody today.
        */}
        <span
          data-figure
          className={clsx('text-3xl font-semibold', nothing ? 'text-text-muted' : `${skin.ink}`)}
        >
          {value}
        </span>
        <span className="text-sm text-text-muted">{label}</span>
      </span>
    </Link>
  );
}

/** A work queue's length. Reads exactly what the destination screen reads. */
function QueueSignal({ signal }: { signal: HomeSignal }) {
  const { t } = useLanguage();
  const queue = useApiCollection(signal.key, signal.url);

  return (
    <Signal
      id={signal.id}
      value={queue.data ? String(queue.data.total) : undefined}
      nothing={queue.data?.total === 0}
      label={t(signal.labelKey)}
      path={signal.path}
      tone={signal.tone}
      icon={signal.icon}
    />
  );
}

/** What a shop owner owes, which is the only figure on this screen that is money. */
function OwedSignal() {
  const { t } = useLanguage();
  const summary = useApiResource<AccountSummary>(OWN_ACCOUNT.key, OWN_ACCOUNT.url);

  return (
    <Signal
      id={OWN_ACCOUNT.id}
      value={summary.data ? formatMinor(summary.data.outstandingBalanceMinor) : undefined}
      nothing={summary.data?.outstandingBalanceMinor === 0}
      label={t(OWN_ACCOUNT.labelKey)}
      path={OWN_ACCOUNT.path}
      tone={OWN_ACCOUNT.tone}
      icon={OWN_ACCOUNT.icon}
    />
  );
}

export function Dashboard() {
  const { t } = useLanguage();
  const user = useAuthStore((state) => state.user);
  const branding = useBranding();
  if (!user) return null;

  const role = user.role as UserRole;
  const signals = signalsFor(role);
  const owed = showsOwnAccount(role);
  const trade = showsTrade(role);

  const items = navItemsFor(role).filter((item) => item.id !== 'dashboard');
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

      {(signals.length > 0 || owed) && (
        <section className="mb-8" data-test="home-signals">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
            {t('home.waitingForYou')}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {signals.map((signal) => (
              <QueueSignal key={signal.id} signal={signal} />
            ))}
            {owed && <OwedSignal />}
          </div>
        </section>
      )}

      {trade && <HomeCharts />}

      {groups.map(({ group, items: groupItems }) => (
        <section key={group} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">
            {t(`dashboard.group${group.charAt(0).toUpperCase()}${group.slice(1)}`)}
          </h2>
          {/*
            Compact rows, not a card each. Twenty destinations rendered as
            twenty description cards is most of a manager's home screen spent
            restating the sidebar in a larger font — so the directory gives up
            the space and the figures above it take it.
          */}
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {groupItems.map((item) => {
              const Icon = NAV_ICON[item.icon];
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className="flex items-start gap-3 rounded-panel border border-border bg-surface p-3 transition-colors hover:border-border-strong hover:bg-surface-hover"
                >
                  <span
                    aria-hidden="true"
                    className={clsx(
                      'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-surface-sunken',
                      GROUP_TONE[group],
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-text">
                      {translatedOr(t, `navItem.${item.id}`, item.label)}
                    </span>
                    {/*
                      `t()` returns the key when it has no entry, which would put
                      "purpose.checkout" on a tile. Not every navigable screen
                      needs a sentence, so a missing one renders nothing.
                    */}
                    {t(`purpose.${item.id}`) !== `purpose.${item.id}` && (
                      <span className="text-sm text-text-muted">{t(`purpose.${item.id}`)}</span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
