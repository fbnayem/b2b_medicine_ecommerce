import { Link } from 'react-router-dom';
import { navItemsFor, type NavGroup } from '@medsupply/navigation';
import type { UserRole } from '@medsupply/shared-types';
import { translatedOr } from '@medsupply/i18n';
import { useAuthStore } from '../store/useAuth';
import { useBranding } from '../lib/useBranding';
import { Card, PageHeader } from '../components/ui';
import { useApiCollection, useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatMinor } from '../lib/finance';
import { OWN_ACCOUNT, showsOwnAccount, signalsFor, type HomeSignal } from '../lib/homeSignals';
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

const GROUP_ORDER: NavGroup[] = [
  'work',
  'catalogue',
  'money',
  'insight',
  'administration',
  'account',
];

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
function Signal({
  value,
  label,
  path,
  id,
  nothing,
}: {
  value: string | undefined;
  label: string;
  path: string;
  id: string;
  /** True when the figure is zero, whatever zero looks like in this currency. */
  nothing: boolean;
}) {
  if (value === undefined) return null;

  return (
    <Card className="p-0">
      <Link
        to={path}
        data-test={`signal-${id}`}
        className="flex h-full flex-col gap-0.5 rounded-lg p-4 hover:bg-surface-hover"
      >
        {/*
          A zero is quieter than a number. It is still shown — "nothing is
          stuck" is an answer, and a card that disappears when empty moves the
          three beside it and reads as a fault — but it should not compete for
          attention with the figure that needs somebody today.
        */}
        <span
          className={`text-3xl font-semibold tabular-nums ${nothing ? 'text-text-muted' : 'text-text'}`}
        >
          {value}
        </span>
        <span className="text-sm text-text-muted">{label}</span>
      </Link>
    </Card>
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
                  <span className="text-lg font-semibold text-text">
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
                </Link>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
