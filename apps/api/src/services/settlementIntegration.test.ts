import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { LedgerAccount, LedgerTransactionType, ShopStatus } from '@medsupply/shared-types';
import { Invoice } from '../models/Invoice';
import { LedgerTransaction } from '../models/LedgerTransaction';
import { Shop } from '../models/Shop';
import { getCreditSummary, getOutstandingReport, getOverdueReport } from './financeService';
import { getInvoiceBalance } from './ledgerService';
import { settlementForInvoice } from './invoiceLedgerQueries';
import { receivablesAgeing } from './reportService';
import { invalidateSettingsCache } from './settingsService';

/**
 * The two things Phase 1 promised about money.
 *
 * First: a credit note must reduce what an invoice owes everywhere, not only
 * in the ageing report. It previously did not — `getInvoiceBalance` summed
 * posted payments alone — so a customer who returned goods still looked fully
 * in debt to the credit check and was refused their next order, while the
 * ageing report showed them settled. Two reports disagreed about money and one
 * of them stopped trade.
 *
 * Second: the receivables reports must run in a bounded number of database
 * operations. The count is asserted rather than the wall clock, because the
 * count is what regressed and is deterministic where timing is flaky.
 */

let memoryReplica: MongoMemoryReplSet | undefined;

/** Counts real driver commands, ignoring the chatter every connection makes. */
class CommandCounter {
  private counts = new Map<string, number>();
  private readonly ignored = new Set(['ping', 'hello', 'ismaster', 'endSessions', 'buildInfo']);

  constructor(private readonly client: mongoose.mongo.MongoClient) {}

  private readonly onStarted = (event: { commandName: string }) => {
    if (this.ignored.has(event.commandName)) return;
    this.counts.set(event.commandName, (this.counts.get(event.commandName) ?? 0) + 1);
  };

  start() {
    this.counts.clear();
    this.client.on('commandStarted', this.onStarted);
    return this;
  }

  stop() {
    this.client.off('commandStarted', this.onStarted);
    return [...this.counts.values()].reduce((sum, value) => sum + value, 0);
  }

  breakdown() {
    return Object.fromEntries(this.counts);
  }
}

async function makeShop(index: number) {
  return Shop.create({
    reference: `SHP-SET-${String(index).padStart(5, '0')}`,
    name: `Settlement Test Pharmacy ${index}`,
    // The shop phone carries a unique index, so it must vary per fixture.
    primaryPhone: `018${String(index).padStart(8, '0')}`,
    status: ShopStatus.ACTIVE,
    creditLimit: 10_000_00,
    paymentTermsDays: 15,
  });
}

/**
 * An issued invoice plus the ledger charge that accompanies it in production,
 * where `fulfilmentService` writes both inside one transaction.
 */
async function issueInvoice(input: {
  shopId: Types.ObjectId;
  index: number;
  grandTotalMinor: number;
  dueDate: Date;
}) {
  const issued = new Date(Date.now() - 60 * 86_400_000);
  const invoice = await Invoice.create({
    reference: `INV-SET-${String(input.index).padStart(6, '0')}`,
    shopId: input.shopId,
    orderId: new Types.ObjectId(),
    supplierSnapshot: { name: 'MedSupply B2B' },
    shopSnapshot: { reference: `SHP-SET-${input.index}`, name: 'Settlement Test Pharmacy' },
    orderSnapshot: { reference: `ORD-SET-${input.index}` },
    deliveryAddressSnapshot: { line1: 'Street', city: 'Dhaka', district: 'Dhaka' },
    status: 'ISSUED',
    items: [],
    subtotalMinor: input.grandTotalMinor,
    orderDiscountMinor: 0,
    taxMinor: 0,
    deliveryChargeMinor: 0,
    grandTotalMinor: input.grandTotalMinor,
    amountDueMinor: input.grandTotalMinor,
    previousBalanceMinor: 0,
    totalOutstandingMinor: input.grandTotalMinor,
    paymentTermsDays: 15,
    invoiceDate: issued,
    dueDate: input.dueDate,
    issuedAt: issued,
    issuedBy: new Types.ObjectId(),
  });
  await postEntry({
    shopId: input.shopId,
    invoiceId: invoice._id,
    type: LedgerTransactionType.INVOICE_CHARGE,
    debitMinor: input.grandTotalMinor,
    creditMinor: 0,
    customerBalanceDeltaMinor: input.grandTotalMinor,
    suffix: `charge-${input.index}`,
  });
  return invoice;
}

let sequence = 0;

/** A single balanced ledger transaction touching accounts receivable. */
async function postEntry(input: {
  shopId: Types.ObjectId;
  invoiceId?: Types.ObjectId;
  type: LedgerTransactionType;
  debitMinor: number;
  creditMinor: number;
  customerBalanceDeltaMinor: number;
  suffix: string;
  occurredAt?: Date;
}) {
  sequence += 1;
  return LedgerTransaction.create({
    reference: `LED-TEST-${String(sequence).padStart(6, '0')}`,
    shopId: input.shopId,
    invoiceId: input.invoiceId,
    type: input.type,
    occurredAt: input.occurredAt ?? new Date(Date.now() - 30 * 86_400_000),
    description: `test ${input.suffix}`,
    entries: [
      {
        account: LedgerAccount.ACCOUNTS_RECEIVABLE,
        debitMinor: input.debitMinor,
        creditMinor: input.creditMinor,
      },
      {
        account: LedgerAccount.SALES,
        debitMinor: input.creditMinor,
        creditMinor: input.debitMinor,
      },
    ],
    customerBalanceDeltaMinor: input.customerBalanceDeltaMinor,
    balanceAfterMinor: 0,
    sourceKey: `test:${input.suffix}:${sequence}`,
    createdBy: new Types.ObjectId(),
  });
}

before(async () => {
  memoryReplica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(memoryReplica.getUri(), { dbName: 'settlement_test' });
});

after(async () => {
  await mongoose.disconnect();
  await memoryReplica?.stop();
});

beforeEach(async () => {
  invalidateSettingsCache();
  await Promise.all([
    Shop.deleteMany({}),
    Invoice.deleteMany({}),
    LedgerTransaction.collection.deleteMany({}),
  ]);
});

test('a credit note reduces what an invoice owes, so it cannot block the next order', async () => {
  const shop = await makeShop(1);
  const invoice = await issueInvoice({
    shopId: shop._id,
    index: 1,
    grandTotalMinor: 5_000_00,
    dueDate: new Date(Date.now() - 45 * 86_400_000),
  });

  const beforeCredit = await getInvoiceBalance(invoice._id);
  assert.equal(beforeCredit.currentAmountDueMinor, 5_000_00, 'the invoice starts fully due');

  const summaryBefore = await getCreditSummary(String(shop._id));
  assert.equal(summaryBefore.overdueMinor, 5_000_00);
  assert.ok(summaryBefore.overdueBlocked, 'an unpaid overdue invoice does block ordering');

  // The customer returns everything and is issued a credit note.
  await postEntry({
    shopId: shop._id,
    invoiceId: invoice._id,
    type: LedgerTransactionType.RETURN_CREDIT,
    debitMinor: 0,
    creditMinor: 5_000_00,
    customerBalanceDeltaMinor: -5_000_00,
    suffix: 'credit-note-1',
  });

  const afterCredit = await getInvoiceBalance(invoice._id);
  assert.equal(afterCredit.currentAmountDueMinor, 0, 'the credit note settles the invoice');
  assert.equal(afterCredit.currentAmountCreditedMinor, 5_000_00);
  assert.equal(afterCredit.settlementStatus, 'PAID');

  const summaryAfter = await getCreditSummary(String(shop._id));
  assert.equal(summaryAfter.overdueMinor, 0, 'the credited invoice is no longer overdue');
  assert.equal(
    summaryAfter.overdueBlocked,
    false,
    'this is the defect: the customer was refused their next order for a debt they no longer had',
  );
});

test('the ageing report and the credit check agree about the same invoice', async () => {
  const shop = await makeShop(2);
  const invoice = await issueInvoice({
    shopId: shop._id,
    index: 2,
    grandTotalMinor: 8_000_00,
    dueDate: new Date(Date.now() - 40 * 86_400_000),
  });
  await postEntry({
    shopId: shop._id,
    invoiceId: invoice._id,
    type: LedgerTransactionType.PAYMENT,
    debitMinor: 0,
    creditMinor: 3_000_00,
    customerBalanceDeltaMinor: -3_000_00,
    suffix: 'payment-2',
  });
  await postEntry({
    shopId: shop._id,
    invoiceId: invoice._id,
    type: LedgerTransactionType.RETURN_CREDIT,
    debitMinor: 0,
    creditMinor: 2_000_00,
    customerBalanceDeltaMinor: -2_000_00,
    suffix: 'credit-note-2',
  });

  const expected = 3_000_00;
  const balance = await getInvoiceBalance(invoice._id);
  const summary = await getCreditSummary(String(shop._id));
  const ageing = await receivablesAgeing({});
  const overdue = await getOverdueReport();

  assert.equal(balance.currentAmountDueMinor, expected);
  assert.equal(summary.overdueMinor, expected, 'the credit check must see the credit note');

  const ageingTotal = ageing.rows
    .filter((row) => String(row.shopId) === String(shop._id))
    .reduce((sum, row) => sum + row.totalMinor, 0);
  assert.equal(ageingTotal, expected, 'the ageing report must agree with the credit check');

  const overdueRow = overdue.data.find((row) => row.shopId === String(shop._id));
  assert.equal(overdueRow?.overdueMinor, expected, 'and so must the overdue report');
});

test('a payment reversal restores the debt everywhere at once', async () => {
  const shop = await makeShop(3);
  const invoice = await issueInvoice({
    shopId: shop._id,
    index: 3,
    grandTotalMinor: 1_000_00,
    dueDate: new Date(Date.now() - 40 * 86_400_000),
  });
  await postEntry({
    shopId: shop._id,
    invoiceId: invoice._id,
    type: LedgerTransactionType.PAYMENT,
    debitMinor: 0,
    creditMinor: 1_000_00,
    customerBalanceDeltaMinor: -1_000_00,
    suffix: 'payment-3',
  });
  assert.equal((await settlementForInvoice(invoice._id)).dueMinor, 0);

  // A reversal mirrors the entries, so receivable is debited back.
  await postEntry({
    shopId: shop._id,
    invoiceId: invoice._id,
    type: LedgerTransactionType.PAYMENT_REVERSAL,
    debitMinor: 1_000_00,
    creditMinor: 0,
    customerBalanceDeltaMinor: 1_000_00,
    suffix: 'reversal-3',
  });

  const settlement = await settlementForInvoice(invoice._id);
  assert.equal(settlement.dueMinor, 1_000_00, 'the debt is owed again');
  assert.equal(settlement.paidMinor, 0, 'and nothing counts as paid');
});

test('the receivables reports run in a bounded number of database operations', async () => {
  // Deliberately wide relative to the fixture: the point is that the count does
  // not grow with the data, not that it hits an exact number.
  const shopCount = 25;
  const invoicesPerShop = 8;

  let index = 0;
  for (let s = 0; s < shopCount; s += 1) {
    const shop = await makeShop(100 + s);
    for (let i = 0; i < invoicesPerShop; i += 1) {
      index += 1;
      await issueInvoice({
        shopId: shop._id,
        index,
        grandTotalMinor: 1_000_00,
        dueDate: new Date(Date.now() - 40 * 86_400_000),
      });
    }
  }

  const client = mongoose.connection.getClient();

  const outstandingCounter = new CommandCounter(client).start();
  const outstanding = await getOutstandingReport();
  const outstandingOps = outstandingCounter.stop();

  const overdueCounter = new CommandCounter(client).start();
  const overdue = await getOverdueReport();
  const overdueOps = overdueCounter.stop();

  assert.equal(outstanding.summary.shopCount, shopCount, 'every shop owes money');
  assert.equal(overdue.summary.overdueShopCount, shopCount);

  // The previous implementation issued roughly 1 + shops x (4 + 2 x invoices)
  // operations — about 525 here, and ~17,500 at production scale. The overdue
  // report then ran the whole thing again.
  const ceiling = 15;
  assert.ok(
    outstandingOps <= ceiling,
    `outstanding report used ${outstandingOps} operations (ceiling ${ceiling}): ${JSON.stringify(
      outstandingCounter.breakdown(),
    )}`,
  );
  assert.ok(
    overdueOps <= ceiling,
    `overdue report used ${overdueOps} operations (ceiling ${ceiling}): ${JSON.stringify(
      overdueCounter.breakdown(),
    )}`,
  );
});

test('the receivables reports are paginated rather than unbounded', async () => {
  for (let s = 0; s < 12; s += 1) {
    const shop = await makeShop(200 + s);
    await issueInvoice({
      shopId: shop._id,
      index: 500 + s,
      grandTotalMinor: (s + 1) * 1_000_00,
      dueDate: new Date(Date.now() - 40 * 86_400_000),
    });
  }

  const firstPage = await getOutstandingReport(new Date(), 1, 5);
  assert.equal(firstPage.data.length, 5, 'a page is a page');
  assert.equal(firstPage.summary.shopCount, 12, 'the total counts every shop, not the page');
  assert.equal(firstPage.summary.pages, 3);

  // Totals must be global: an accountant paging through a report whose total
  // changed underneath them would have no figure to reconcile against.
  const secondPage = await getOutstandingReport(new Date(), 2, 5);
  assert.equal(
    secondPage.summary.totalOutstandingMinor,
    firstPage.summary.totalOutstandingMinor,
    'the total must not change as you page',
  );

  // Sorted by size, so page one carries the largest debts.
  const largest = firstPage.data[0]!.outstandingMinor;
  assert.equal(largest, 12 * 1_000_00);
});
