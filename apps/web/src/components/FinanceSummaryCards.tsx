import { formatMinor } from '../lib/finance';
import type { AccountSummary } from '../pages/financeTypes';
import { formatPercentFromBasisPoints } from '@medsupply/utilities';

export function FinanceSummaryCards({ summary }: { summary: AccountSummary }) {
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
    <>
      {summary.creditBlocked ? (
        <section className="state error" role="status">
          Credit ordering is blocked
          {summary.creditBlockReason ? `: ${summary.creditBlockReason}` : '.'}
        </section>
      ) : null}
      <section className="metric-grid finance-metrics">
        <article>
          <span>Current due</span>
          <strong>{formatMinor(summary.outstandingBalanceMinor)}</strong>
        </article>
        <article>
          <span>Overdue</span>
          <strong>{formatMinor(summary.overdueBalanceMinor)}</strong>
        </article>
        <article>
          <span>Available credit</span>
          <strong>{formatMinor(summary.availableCreditMinor)}</strong>
        </article>
        <article>
          <span>Credit utilisation</span>
          <strong>{formatPercentFromBasisPoints(utilisation)}</strong>
        </article>
      </section>
    </>
  );
}
