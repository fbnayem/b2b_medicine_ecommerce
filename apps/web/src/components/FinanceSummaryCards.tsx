import { formatPercentFromBasisPoints } from '@medsupply/utilities';
import { formatMinor } from '../lib/finance';
import type { AccountSummary } from '../pages/financeTypes';
import { useLanguage } from '../lib/useLanguage';
import { Stat, StatGrid } from './ui';

/**
 * The four credit figures, above a customer account.
 *
 * These were laid out by `metric-grid finance-metrics` and warned with
 * `state error` — all three from `inventory.css`, deleted when the pages moved
 * onto the design system while `components/` was never audited. So the figures
 * rendered as four unstyled label/value pairs, and the credit block, the one
 * thing on the screen that stops somebody placing an order, was a plain
 * sentence indistinguishable from the rest.
 */
export function FinanceSummaryCards({ summary }: { summary: AccountSummary }) {
  const { t } = useLanguage();

  const utilisation =
    summary.creditUtilisationBasisPoints == null
      ? summary.creditLimitMinor > 0
        ? Math.min(
            10_000,
            Math.round((summary.outstandingBalanceMinor * 10_000) / summary.creditLimitMinor),
          )
        : 0
      : summary.creditUtilisationBasisPoints;

  return (
    <div className="mb-6 flex flex-col gap-3">
      {summary.creditBlocked && (
        <p
          role="status"
          className="rounded-lg border border-danger bg-danger-subtle px-4 py-3 font-medium text-text"
        >
          {summary.creditBlockReason
            ? t('accountSummary.blockedWithReason', { reason: summary.creditBlockReason })
            : t('accountSummary.blocked')}
        </p>
      )}
      <StatGrid>
        <Stat
          label={t('accountSummary.currentDue')}
          value={formatMinor(summary.outstandingBalanceMinor)}
        />
        <Stat
          label={t('accountSummary.overdue')}
          value={formatMinor(summary.overdueBalanceMinor)}
          // Anything overdue is the figure somebody has to act on, so it does
          // not look like the three beside it.
          tone={summary.overdueBalanceMinor > 0 ? 'danger' : 'neutral'}
        />
        <Stat
          label={t('accountSummary.availableCredit')}
          value={formatMinor(summary.availableCreditMinor)}
          tone={summary.availableCreditMinor <= 0 ? 'warning' : 'neutral'}
        />
        <Stat
          label={t('accountSummary.utilisation')}
          value={formatPercentFromBasisPoints(utilisation)}
          note={t('accountSummary.utilisationNote')}
          tone={utilisation >= 10_000 ? 'danger' : utilisation >= 8_000 ? 'warning' : 'neutral'}
        />
      </StatGrid>
    </div>
  );
}
