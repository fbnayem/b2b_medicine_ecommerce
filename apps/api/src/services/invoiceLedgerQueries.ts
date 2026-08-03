import { ClientSession, PipelineStage, Types } from 'mongoose';
import { LedgerAccount, LedgerTransactionType } from '@medsupply/shared-types';
import { LedgerTransaction } from '../models/LedgerTransaction';

/**
 * What is owed on an invoice, answered from the ledger and nowhere else.
 *
 * There used to be two answers. `getInvoiceBalance` summed posted
 * `Payment.invoiceAppliedMinor`; `receivablesAgeing` summed payments *and*
 * subtracted `CreditNote.totalMinor`. So a customer who returned goods and was
 * issued a credit note still showed that invoice fully due to the credit check,
 * which refused their next order, while the ageing report showed them settled.
 * Two reports disagreed about money and one of them stopped trade.
 *
 * The fix is to have one implementation, and to derive it from the append-only
 * ledger, which already records every event that moves an invoice: the charge,
 * payments, payment reversals and return credits.
 *
 * **The quantity is accounts-receivable movement, not
 * `customerBalanceDeltaMinor`.** That field is a shop-level figure and is wrong
 * per invoice in both directions:
 *
 *  - An overpayment carries a delta of the whole amount received, while only
 *    the part that fits the invoice is applied to it and the excess becomes
 *    customer advance. Summing the delta would drive the invoice negative.
 *  - A payment made *from* advance balance carries a delta of zero, because the
 *    customer's overall position has not moved — but the invoice is genuinely
 *    paid. Summing the delta would leave it looking unpaid forever.
 *
 * The `ACCOUNTS_RECEIVABLE` entries have neither problem: the charge debits the
 * grand total, a payment credits exactly the part applied to the invoice, a
 * reversal debits it back, and a credit note credits the returned value. Their
 * net movement is the amount still owed, by construction and by double entry.
 */

export interface InvoiceSettlement {
  chargedMinor: number;
  /** Payments applied to this invoice, net of any reversal. */
  paidMinor: number;
  /** Return credits applied to this invoice. */
  creditedMinor: number;
  /** Still owed. Authoritative: the net receivable movement, whatever caused it. */
  dueMinor: number;
  settlementStatus: 'PAID' | 'PARTIALLY_PAID' | 'UNPAID';
}

const EMPTY: InvoiceSettlement = {
  chargedMinor: 0,
  paidMinor: 0,
  creditedMinor: 0,
  dueMinor: 0,
  settlementStatus: 'UNPAID',
};

const netReceivable = { $subtract: ['$entries.debitMinor', '$entries.creditMinor'] };
const netCredited = { $subtract: ['$entries.creditMinor', '$entries.debitMinor'] };

const isType = (...types: LedgerTransactionType[]) =>
  types.length === 1 ? { $eq: ['$type', types[0]] } : { $in: ['$type', types] };

/**
 * Aggregation stages that reduce ledger transactions to one settlement row per
 * invoice. Shared so that a report grouping thousands of invoices runs the same
 * arithmetic as a single credit check, in one round trip rather than one per
 * invoice.
 *
 * Callers supply the `$match` that selects the transactions; this handles the
 * rest. `asOf` bounds the ledger to a point in time for as-of reporting.
 */
export function invoiceSettlementStages(asOf?: Date): PipelineStage[] {
  return [
    ...(asOf ? [{ $match: { occurredAt: { $lte: asOf } } }] : []),
    { $unwind: '$entries' },
    { $match: { 'entries.account': LedgerAccount.ACCOUNTS_RECEIVABLE } },
    {
      $group: {
        _id: '$invoiceId',
        // Authoritative. Any receivable movement counts, including an
        // adjustment that a later phase might attach to an invoice.
        dueMinor: { $sum: netReceivable },
        chargedMinor: {
          $sum: { $cond: [isType(LedgerTransactionType.INVOICE_CHARGE), netReceivable, 0] },
        },
        paidMinor: {
          $sum: {
            $cond: [
              isType(LedgerTransactionType.PAYMENT, LedgerTransactionType.PAYMENT_REVERSAL),
              netCredited,
              0,
            ],
          },
        },
        creditedMinor: {
          $sum: { $cond: [isType(LedgerTransactionType.RETURN_CREDIT), netCredited, 0] },
        },
      },
    },
  ];
}

function toSettlement(
  row: { chargedMinor: number; paidMinor: number; creditedMinor: number; dueMinor: number },
  fallbackChargeMinor?: number,
): InvoiceSettlement {
  const settled = row.paidMinor + row.creditedMinor;

  // An issued invoice with no charge in the ledger is a data fault, not a
  // settled account. The Phase 8 migration reports exactly this condition
  // (INVOICE_CHARGE_REQUIRES_AUTHORISED_POSTING) for invoices predating the
  // ledger, and deployment is supposed to resolve them before finance traffic.
  // If one slips through anyway, reading the ledger alone would report the
  // invoice as owing nothing — understating receivables, which is the one
  // direction a finance report must never err in. Falling back to the invoice's
  // own total errs the safe way instead.
  const charged = row.chargedMinor > 0 ? row.chargedMinor : (fallbackChargeMinor ?? 0);
  const dueMinor =
    row.chargedMinor > 0
      ? // Clamped: an over-application would otherwise report a negative amount
        // owed, which every caller would then have to defend against.
        Math.max(0, row.dueMinor)
      : Math.max(0, charged - settled);

  return {
    chargedMinor: charged,
    paidMinor: row.paidMinor,
    creditedMinor: row.creditedMinor,
    dueMinor,
    settlementStatus: dueMinor === 0 ? 'PAID' : settled > 0 ? 'PARTIALLY_PAID' : 'UNPAID',
  };
}

/**
 * Settlement for many invoices in a single round trip.
 *
 * This is the shape every caller should reach for. The reports it replaced
 * looped over invoices awaiting a two-query balance each, which is how the
 * outstanding report reached roughly 17,500 database operations for 500 shops.
 */
export async function settlementForInvoices(
  invoiceIds: (string | Types.ObjectId)[],
  options: {
    session?: ClientSession;
    asOf?: Date;
    /**
     * Invoice grand totals, keyed by id. Supplied by callers that already hold
     * the documents, so an invoice missing its ledger charge is reported as
     * fully due rather than as settled. See `toSettlement`.
     */
    fallbackChargeMinor?: Map<string, number>;
  } = {},
): Promise<Map<string, InvoiceSettlement>> {
  const result = new Map<string, InvoiceSettlement>();
  if (invoiceIds.length === 0) return result;

  const ids = invoiceIds.map((id) => new Types.ObjectId(String(id)));
  const aggregate = LedgerTransaction.aggregate<{
    _id: Types.ObjectId;
    chargedMinor: number;
    paidMinor: number;
    creditedMinor: number;
    dueMinor: number;
  }>([{ $match: { invoiceId: { $in: ids } } }, ...invoiceSettlementStages(options.asOf)]);
  if (options.session) aggregate.session(options.session);

  for (const row of await aggregate) {
    const key = String(row._id);
    result.set(key, toSettlement(row, options.fallbackChargeMinor?.get(key)));
  }
  // An invoice with no ledger movement at all still owes its own total, if the
  // caller told us what that is; otherwise there is nothing to report.
  for (const id of ids) {
    const key = String(id);
    if (result.has(key)) continue;
    const fallback = options.fallbackChargeMinor?.get(key);
    result.set(
      key,
      fallback
        ? toSettlement({ chargedMinor: 0, paidMinor: 0, creditedMinor: 0, dueMinor: 0 }, fallback)
        : EMPTY,
    );
  }
  return result;
}

export async function settlementForInvoice(
  invoiceId: string | Types.ObjectId,
  options: {
    session?: ClientSession;
    asOf?: Date;
    fallbackChargeMinor?: number;
  } = {},
): Promise<InvoiceSettlement> {
  const key = String(invoiceId);
  const map = await settlementForInvoices([invoiceId], {
    session: options.session,
    asOf: options.asOf,
    fallbackChargeMinor:
      options.fallbackChargeMinor === undefined
        ? undefined
        : new Map([[key, options.fallbackChargeMinor]]),
  });
  return map.get(key) ?? EMPTY;
}
