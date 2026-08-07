import { apiClient } from '../api/client';
import { formatMoneyMinor } from '../finance/money';

/**
 * The reports, on a phone.
 *
 * **One screen, not seven.** The shared manifest has five `analytics-*`
 * destinations and three finance ones, and on a monitor each is its own page of
 * charts. A phone shows one report at a time and changes it with a chip row, so
 * eight ids land on two screens — which is what `MOBILE_ROUTE` exists to allow.
 *
 * Each report here is reduced to **a few headline figures and one list**. That
 * is not the desktop dashboard made small; it is the answer to "how is it
 * going" that somebody wants between two other things. Anybody who needs the
 * breakdown opens the web application, and this says so rather than pretending.
 *
 * Two of these — the order funnel and stock movements — had **no caller on any
 * client**. Finished report endpoints with no screen anywhere.
 */

type Envelope<T> = { data: T };

/** A figure with its name, already formatted. */
export interface Headline {
  labelKey: string;
  value: string;
}

/** One row of the single list a report reduces to. */
export interface ReportRow {
  key: string;
  label: string;
  value: string;
}

export interface ReportView {
  headlines: Headline[];
  rows: ReportRow[];
}

const basisPointsAsPercent = (points: number) => `${(points / 100).toFixed(1)}%`;
const count = (value: number) => String(value ?? 0);

/**
 * Every report this client can show, and how each is reduced.
 *
 * Written out per kind rather than rendered generically from whatever fields a
 * response happens to have. A generic renderer would print `netAfterReturnsMinor`
 * at somebody, and would silently start printing a new field the day the server
 * grew one.
 */
export const REPORTS: Record<
  string,
  { path: string; ranged: boolean; view: (data: never) => ReportView }
> = {
  sales: {
    path: '/reports/sales',
    ranged: true,
    view: (data: never) => {
      const value = data as unknown as {
        totals?: { netMinor?: number; grossMinor?: number; invoiceCount?: number };
        byMedicine?: Array<{ brandName?: string; netMinor?: number }>;
      };
      return {
        headlines: [
          { labelKey: 'reportsMobile.net', value: formatMoneyMinor(value.totals?.netMinor ?? 0) },
          {
            labelKey: 'reportsMobile.gross',
            value: formatMoneyMinor(value.totals?.grossMinor ?? 0),
          },
          {
            labelKey: 'reportsMobile.invoices',
            value: count(value.totals?.invoiceCount ?? 0),
          },
        ],
        rows: (value.byMedicine ?? []).slice(0, 20).map((row, index) => ({
          key: `${row.brandName ?? index}`,
          label: row.brandName ?? '—',
          value: formatMoneyMinor(row.netMinor ?? 0),
        })),
      };
    },
  },

  orders: {
    // No caller on any client before this phase.
    path: '/reports/orders',
    ranged: true,
    view: (data: never) => {
      const value = data as unknown as {
        funnel?: Record<string, number>;
        conversionBasisPoints?: { approval?: number; fulfilment?: number; delivery?: number };
      };
      return {
        headlines: [
          {
            labelKey: 'reportsMobile.approvalRate',
            value: basisPointsAsPercent(value.conversionBasisPoints?.approval ?? 0),
          },
          {
            labelKey: 'reportsMobile.deliveryRate',
            value: basisPointsAsPercent(value.conversionBasisPoints?.delivery ?? 0),
          },
        ],
        // The funnel in the order it happens, which is the only order it means
        // anything in.
        rows: [
          'submitted',
          'reviewed',
          'approved',
          'rejected',
          'invoiced',
          'delivered',
          'cancelled',
        ].map((stage) => ({
          key: stage,
          label: stage,
          value: count(value.funnel?.[stage] ?? 0),
        })),
      };
    },
  },

  inventory: {
    path: '/reports/inventory',
    ranged: false,
    view: (data: never) => {
      const value = data as unknown as {
        totals?: { valuationMinor?: number; batchCount?: number; unitsOnHand?: number };
        expiryBuckets?: Array<{ bucket?: string; valuationMinor?: number }>;
      };
      return {
        headlines: [
          {
            labelKey: 'reportsMobile.stockValue',
            value: formatMoneyMinor(value.totals?.valuationMinor ?? 0),
          },
          { labelKey: 'reportsMobile.batches', value: count(value.totals?.batchCount ?? 0) },
          { labelKey: 'reportsMobile.units', value: count(value.totals?.unitsOnHand ?? 0) },
        ],
        rows: (value.expiryBuckets ?? []).map((row, index) => ({
          key: `${row.bucket ?? index}`,
          label: row.bucket ?? '—',
          value: formatMoneyMinor(row.valuationMinor ?? 0),
        })),
      };
    },
  },

  deliveries: {
    path: '/reports/deliveries',
    ranged: true,
    view: (data: never) => {
      const value = data as unknown as {
        totals?: { delivered?: number; failed?: number; onTimeBasisPoints?: number };
        byPerson?: Array<{ name?: string; delivered?: number }>;
      };
      return {
        headlines: [
          {
            labelKey: 'reportsMobile.onTime',
            value: basisPointsAsPercent(value.totals?.onTimeBasisPoints ?? 0),
          },
          { labelKey: 'reportsMobile.delivered', value: count(value.totals?.delivered ?? 0) },
          { labelKey: 'reportsMobile.failed', value: count(value.totals?.failed ?? 0) },
        ],
        rows: (value.byPerson ?? []).map((row, index) => ({
          key: `${row.name ?? index}`,
          label: row.name ?? '—',
          value: count(row.delivered ?? 0),
        })),
      };
    },
  },

  returns: {
    path: '/reports/returns',
    ranged: true,
    view: (data: never) => {
      const value = data as unknown as {
        totals?: { creditedMinor?: number; unitsReturned?: number; returnRateBasisPoints?: number };
        byReason?: Array<{ reason?: string; returnCount?: number }>;
      };
      return {
        headlines: [
          {
            labelKey: 'reportsMobile.credited',
            value: formatMoneyMinor(value.totals?.creditedMinor ?? 0),
          },
          {
            labelKey: 'reportsMobile.returnRate',
            value: basisPointsAsPercent(value.totals?.returnRateBasisPoints ?? 0),
          },
          {
            labelKey: 'reportsMobile.unitsBack',
            value: count(value.totals?.unitsReturned ?? 0),
          },
        ],
        rows: (value.byReason ?? []).map((row, index) => ({
          key: `${row.reason ?? index}`,
          label: row.reason ?? '—',
          value: count(row.returnCount ?? 0),
        })),
      };
    },
  },

  receivables: {
    path: '/reports/receivables-ageing',
    ranged: false,
    view: (data: never) => {
      const value = data as unknown as {
        buckets?: Array<{ bucket?: string; amountMinor?: number }>;
        totalMinor?: number;
      };
      return {
        headlines: [
          {
            labelKey: 'reportsMobile.owedInTotal',
            value: formatMoneyMinor(value.totalMinor ?? 0),
          },
        ],
        rows: (value.buckets ?? []).map((row, index) => ({
          key: `${row.bucket ?? index}`,
          label: row.bucket ?? '—',
          value: formatMoneyMinor(row.amountMinor ?? 0),
        })),
      };
    },
  },

  movements: {
    // The other one with no caller anywhere.
    path: '/reports/stock-movements',
    ranged: true,
    view: (data: never) => {
      const value = data as unknown as {
        data?: Array<{ type?: string; count?: number; quantity?: number }>;
      };
      const rows = value.data ?? [];
      return {
        headlines: [
          {
            labelKey: 'reportsMobile.movements',
            value: count(rows.reduce((sum, row) => sum + (row.count ?? 0), 0)),
          },
        ],
        rows: rows.map((row, index) => ({
          key: `${row.type ?? index}`,
          label: row.type ?? '—',
          value: count(row.quantity ?? 0),
        })),
      };
    },
  },
};

/** The three finance reports, which share a shape and a screen. */
export const FINANCE_REPORTS: Record<string, string> = {
  outstanding: '/finance/reports/outstanding',
  overdue: '/finance/reports/overdue',
  collections: '/finance/reports/collections',
};

export async function getReport(kind: string, from?: string, to?: string): Promise<ReportView> {
  const report = REPORTS[kind];
  if (!report) throw new Error(`Unknown report: ${kind}`);
  const response = await apiClient.get<Envelope<unknown>>(report.path, {
    params: report.ranged && from && to ? { from, to } : {},
  });
  return report.view(response.data.data as never);
}

export async function getFinanceReport(kind: string) {
  const path = FINANCE_REPORTS[kind];
  if (!path) throw new Error(`Unknown finance report: ${kind}`);
  const response = await apiClient.get<Envelope<unknown>>(path);
  return response.data.data;
}
