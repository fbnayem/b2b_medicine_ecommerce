import { ClientSession, Types } from 'mongoose';
import { LedgerAccount, LedgerTransactionType, UserRole } from '@medsupply/shared-types';
import { AuditLog } from '../models/AuditLog';
import { nextReference } from '../models/Counter';
import { Invoice } from '../models/Invoice';
import { LedgerTransaction } from '../models/LedgerTransaction';
import { Shop } from '../models/Shop';
import { assertBalancedEntries, FinancialEntry, safeAdd } from './financialMath';
import { settlementForInvoice } from './invoiceLedgerQueries';

export type FinanceActor = {
  _id: Types.ObjectId;
  role: UserRole;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
};

function withSession<T extends { session(value: ClientSession): T }>(
  query: T,
  session?: ClientSession,
) {
  return session ? query.session(session) : query;
}

export async function getLedgerBalance(shopId: string | Types.ObjectId, session?: ClientSession) {
  const aggregate = LedgerTransaction.aggregate<{ balance: number }>([
    { $match: { shopId: new Types.ObjectId(String(shopId)) } },
    { $group: { _id: null, balance: { $sum: '$customerBalanceDeltaMinor' } } },
  ]);
  if (session) aggregate.session(session);
  const [result] = await aggregate;
  const balance = result?.balance ?? 0;
  if (!Number.isSafeInteger(balance)) {
    throw Object.assign(new Error('Ledger balance exceeds the safe integer range'), {
      statusCode: 500,
      code: 'LEDGER_OVERFLOW',
    });
  }
  return balance;
}

export async function getAvailableAdvance(
  shopId: string | Types.ObjectId,
  session?: ClientSession,
) {
  const aggregate = LedgerTransaction.aggregate<{ balance: number }>([
    { $match: { shopId: new Types.ObjectId(String(shopId)) } },
    { $unwind: '$entries' },
    { $match: { 'entries.account': LedgerAccount.CUSTOMER_ADVANCE } },
    {
      $group: {
        _id: null,
        balance: {
          $sum: { $subtract: ['$entries.creditMinor', '$entries.debitMinor'] },
        },
      },
    },
  ]);
  if (session) aggregate.session(session);
  const [result] = await aggregate;
  const balance = result?.balance ?? 0;
  if (!Number.isSafeInteger(balance) || balance < 0) {
    throw Object.assign(new Error('Customer advance ledger is inconsistent'), {
      statusCode: 500,
      code: 'ADVANCE_LEDGER_INVALID',
    });
  }
  return balance;
}

export async function getInvoiceBalance(
  invoiceId: string | Types.ObjectId,
  session?: ClientSession,
) {
  const invoice = await withSession(Invoice.findById(invoiceId), session);
  if (!invoice) {
    throw Object.assign(new Error('Invoice not found'), { statusCode: 404, code: 'NOT_FOUND' });
  }
  // Previously this summed posted `Payment.invoiceAppliedMinor` and nothing
  // else, so a credit note was invisible here while the ageing report did
  // subtract it. The customer who had returned goods still looked fully in debt
  // to `overdueForShop`, and their next order was refused. One implementation
  // now, and it reads the ledger, which records the credit note too.
  const settlement = await settlementForInvoice(invoice._id, {
    session,
    fallbackChargeMinor: invoice.grandTotalMinor,
  });
  return {
    invoice,
    currentAmountPaidMinor: settlement.paidMinor,
    currentAmountDueMinor: settlement.dueMinor,
    currentAmountCreditedMinor: settlement.creditedMinor,
    settlementStatus: settlement.settlementStatus,
  } as const;
}

export async function appendLedgerTransaction(
  input: {
    shopId: Types.ObjectId;
    invoiceId?: Types.ObjectId;
    paymentId?: Types.ObjectId;
    deliveryId?: Types.ObjectId;
    type: LedgerTransactionType;
    occurredAt: Date;
    description: string;
    entries: FinancialEntry[];
    customerBalanceDeltaMinor: number;
    sourceKey: string;
    reversalOf?: Types.ObjectId;
    createdBy: Types.ObjectId;
  },
  session: ClientSession,
) {
  assertBalancedEntries(input.entries);
  const existing = await LedgerTransaction.findOne({ sourceKey: input.sourceKey }).session(session);
  if (existing) return { transaction: existing, idempotentReplay: true };
  const currentBalance = await getLedgerBalance(input.shopId, session);
  const balanceAfterMinor = safeAdd(currentBalance, input.customerBalanceDeltaMinor);
  const [transaction] = await LedgerTransaction.create(
    [
      {
        reference: await nextReference('LED'),
        ...input,
        balanceAfterMinor,
      },
    ],
    { session },
  );
  await Shop.updateOne(
    { _id: input.shopId },
    { $set: { outstandingBalance: balanceAfterMinor } },
    { session },
  );
  return { transaction, idempotentReplay: false };
}

export async function postInvoiceCharge(
  invoice: InstanceType<typeof Invoice>,
  actor: FinanceActor,
  session: ClientSession,
) {
  const amount = invoice.grandTotalMinor;
  return appendLedgerTransaction(
    {
      shopId: invoice.shopId as Types.ObjectId,
      invoiceId: invoice._id,
      type: LedgerTransactionType.INVOICE_CHARGE,
      occurredAt: invoice.invoiceDate,
      description: `Invoice ${invoice.reference}`,
      entries: [
        {
          account: LedgerAccount.ACCOUNTS_RECEIVABLE,
          debitMinor: amount,
          creditMinor: 0,
        },
        { account: LedgerAccount.SALES, debitMinor: 0, creditMinor: amount },
      ],
      customerBalanceDeltaMinor: amount,
      sourceKey: `invoice:${invoice._id}`,
      createdBy: actor._id,
    },
    session,
  );
}

/**
 * Credits a customer for returned goods. Mirrors the invoice charge: the sales
 * value comes back out through the RETURNS control account and the customer's
 * receivable falls by the same amount, so the ledger stays balanced and the
 * credit is traceable to both the invoice and the return.
 */
export async function postReturnCredit(
  input: {
    shopId: Types.ObjectId;
    invoiceId: Types.ObjectId;
    returnId: Types.ObjectId;
    creditNoteReference: string;
    amountMinor: number;
    occurredAt: Date;
  },
  actor: FinanceActor,
  session: ClientSession,
) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw Object.assign(new Error('A credit note must credit a positive integer amount'), {
      statusCode: 400,
      code: 'INVALID_MONEY',
    });
  }
  return appendLedgerTransaction(
    {
      shopId: input.shopId,
      invoiceId: input.invoiceId,
      type: LedgerTransactionType.RETURN_CREDIT,
      occurredAt: input.occurredAt,
      description: `Credit note ${input.creditNoteReference}`,
      entries: [
        { account: LedgerAccount.RETURNS, debitMinor: input.amountMinor, creditMinor: 0 },
        {
          account: LedgerAccount.ACCOUNTS_RECEIVABLE,
          debitMinor: 0,
          creditMinor: input.amountMinor,
        },
      ],
      customerBalanceDeltaMinor: -input.amountMinor,
      // Keyed on the return so a retried credit issue can never double-credit.
      sourceKey: `return-credit:${input.returnId}`,
      createdBy: actor._id,
    },
    session,
  );
}

export async function postLedgerAdjustment(
  input: {
    shopId: string;
    type: 'OPENING_BALANCE' | 'CREDIT_ADJUSTMENT' | 'DEBIT_ADJUSTMENT' | 'RETURN_CREDIT';
    amountMinor: number;
    occurredAt: Date;
    description: string;
    idempotencyKey: string;
  },
  actor: FinanceActor,
  session: ClientSession,
) {
  const credit =
    input.type === LedgerTransactionType.CREDIT_ADJUSTMENT ||
    input.type === LedgerTransactionType.RETURN_CREDIT;
  const control =
    input.type === LedgerTransactionType.RETURN_CREDIT
      ? LedgerAccount.RETURNS
      : LedgerAccount.ADJUSTMENTS;
  const entries: FinancialEntry[] = credit
    ? [
        { account: control, debitMinor: input.amountMinor, creditMinor: 0 },
        {
          account: LedgerAccount.ACCOUNTS_RECEIVABLE,
          debitMinor: 0,
          creditMinor: input.amountMinor,
        },
      ]
    : [
        {
          account: LedgerAccount.ACCOUNTS_RECEIVABLE,
          debitMinor: input.amountMinor,
          creditMinor: 0,
        },
        { account: control, debitMinor: 0, creditMinor: input.amountMinor },
      ];
  const result = await appendLedgerTransaction(
    {
      shopId: new Types.ObjectId(input.shopId),
      type: input.type as LedgerTransactionType,
      occurredAt: input.occurredAt,
      description: input.description,
      entries,
      customerBalanceDeltaMinor: credit ? -input.amountMinor : input.amountMinor,
      sourceKey: `adjustment:${input.idempotencyKey}`,
      createdBy: actor._id,
    },
    session,
  );
  if (!result.idempotentReplay) {
    await AuditLog.create(
      [
        {
          actorId: actor._id,
          actorRole: actor.role,
          action: input.type,
          entityType: 'LedgerTransaction',
          entityId: result.transaction._id,
          after: {
            reference: result.transaction.reference,
            shopId: input.shopId,
            amountMinor: input.amountMinor,
            description: input.description,
          },
        },
      ],
      { session },
    );
  }
  return result;
}

export function dhakaDayBoundary(value: string, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw Object.assign(new Error('Dates must use YYYY-MM-DD'), {
      statusCode: 400,
      code: 'INVALID_DATE',
    });
  }
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+06:00`);
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error('Date is invalid'), { statusCode: 400, code: 'INVALID_DATE' });
  }
  return date;
}

export function dhakaDateString(value = new Date()) {
  return new Date(value.getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
