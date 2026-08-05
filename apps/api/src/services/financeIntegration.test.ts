import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  LedgerAccount,
  LedgerTransactionType,
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
  ShopStatus,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../app';
import { Invoice } from '../models/Invoice';
import { LedgerTransaction } from '../models/LedgerTransaction';
import { Payment } from '../models/Payment';
import { PaymentAttachment } from '../models/PaymentAttachment';
import { Shop } from '../models/Shop';
import { User } from '../models/User';

/**
 * The finance desk, over HTTP.
 *
 * Eighteen endpoints in this area had never been called by a test. They were
 * chosen as the first tranche of the burn-down for the obvious reason: this is
 * where the money is, and every one of them either states what a customer owes
 * or changes it.
 *
 * The shape of each test is the one the plan sets out — the happy path, the
 * role refusal, and **one rule specific to the endpoint that would be wrong in
 * a way nobody notices**. It is the third that finds things. A list that
 * returns 200 with somebody else's payments in it passes the first two.
 *
 * Two fixture hazards, both already met the hard way in this repository:
 * references here are taken from outside the counter's series (`-FIN-`) so they
 * cannot collide with `nextReference`, and every shop gets its own
 * `primaryPhone`, which carries a unique index.
 */

let memoryReplica: MongoMemoryReplSet | undefined;
let server: Server | undefined;
let base = '';

const admin = { _id: new Types.ObjectId(), role: UserRole.ADMIN };
const manager = { _id: new Types.ObjectId(), role: UserRole.MANAGER };
const owner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };
const otherOwner = { _id: new Types.ObjectId(), role: UserRole.SHOP_OWNER };
const rider = { _id: new Types.ObjectId(), role: UserRole.DELIVERY_PERSON };
const storekeeper = { _id: new Types.ObjectId(), role: UserRole.STOREKEEPER };

let shop: Types.ObjectId;
let otherShop: Types.ObjectId;
let invoice: Types.ObjectId;
let otherInvoice: Types.ObjectId;

/** A payment belonging to `shop`, pending, with an attachment. */
let pendingPayment: Types.ObjectId;
/** A posted payment belonging to `otherShop`. */
let foreignPayment: Types.ObjectId;
/** Collected at the door by `rider`. */
let riderCollection: Types.ObjectId;
/** Collected in the office, with `rider` recorded as collector. */
let officeCollection: Types.ObjectId;

function headers(user: { _id: Types.ObjectId }) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${jwt.sign({ userId: user._id }, process.env.JWT_SECRET!)}`,
  };
}

async function get(path: string, as: { _id: Types.ObjectId }) {
  const response = await fetch(`${base}${path}`, { headers: headers(as) });
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    body: text.startsWith('{') ? (JSON.parse(text) as Record<string, never>) : ({} as never),
    text,
  };
}

async function post(path: string, as: { _id: Types.ObjectId }, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: headers(as),
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, body: (await response.json()) as Record<string, never> };
}

let sequence = 0;

/** One balanced ledger transaction against receivables. */
async function postEntry(input: {
  shopId: Types.ObjectId;
  invoiceId?: Types.ObjectId;
  paymentId?: Types.ObjectId;
  type: (typeof LedgerTransactionType)[keyof typeof LedgerTransactionType];
  debitMinor: number;
  creditMinor: number;
  deltaMinor: number;
}) {
  sequence += 1;
  return LedgerTransaction.create({
    reference: `LED-FIN-${String(sequence).padStart(6, '0')}`,
    shopId: input.shopId,
    invoiceId: input.invoiceId,
    paymentId: input.paymentId,
    type: input.type,
    occurredAt: new Date(Date.now() - 20 * 86_400_000),
    description: `finance fixture ${sequence}`,
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
    customerBalanceDeltaMinor: input.deltaMinor,
    balanceAfterMinor: 0,
    sourceKey: `finance-test:${sequence}`,
    createdBy: manager._id,
  });
}

async function makeShop(index: number, name: string, owners: Types.ObjectId[], balance: number) {
  const created = await Shop.create({
    reference: `SHP-FIN-${String(index).padStart(5, '0')}`,
    name,
    ownerIds: owners,
    primaryPhone: `0199000${String(index).padStart(4, '0')}`,
    status: ShopStatus.ACTIVE,
    creditLimit: 100_000_00,
    paymentTermsDays: 15,
    outstandingBalance: balance,
    deliveryAddresses: [
      { label: 'Shop', line1: '1 Green Road', city: 'Dhaka', district: 'Dhaka', isDefault: true },
    ],
  });
  return created._id;
}

async function makeInvoice(index: number, shopId: Types.ObjectId, totalMinor: number, due: Date) {
  const issued = new Date(Date.now() - 45 * 86_400_000);
  const created = await Invoice.create({
    reference: `INV-FIN-${String(index).padStart(6, '0')}`,
    shopId,
    orderId: new Types.ObjectId(),
    supplierSnapshot: { name: 'MedSupply B2B' },
    shopSnapshot: { reference: `SHP-FIN-${index}`, name: 'Finance Fixture' },
    orderSnapshot: { reference: `ORD-FIN-${index}` },
    deliveryAddressSnapshot: { line1: '1 Green Road', city: 'Dhaka', district: 'Dhaka' },
    status: 'ISSUED',
    items: [],
    subtotalMinor: totalMinor,
    orderDiscountMinor: 0,
    taxMinor: 0,
    deliveryChargeMinor: 0,
    grandTotalMinor: totalMinor,
    amountDueMinor: totalMinor,
    previousBalanceMinor: 0,
    totalOutstandingMinor: totalMinor,
    paymentTermsDays: 15,
    invoiceDate: issued,
    dueDate: due,
    issuedAt: issued,
    issuedBy: manager._id,
  });
  return created._id;
}

async function makePayment(input: {
  index: number;
  shopId: Types.ObjectId;
  invoiceId?: Types.ObjectId;
  amountMinor: number;
  status: (typeof PaymentStatus)[keyof typeof PaymentStatus];
  source: (typeof PaymentSource)[keyof typeof PaymentSource];
  collectedBy?: Types.ObjectId;
}) {
  const created = await Payment.create({
    reference: `PAY-FIN-${String(input.index).padStart(6, '0')}`,
    shopId: input.shopId,
    invoiceId: input.invoiceId,
    amountMinor: input.amountMinor,
    invoiceAppliedMinor: input.status === PaymentStatus.POSTED ? input.amountMinor : 0,
    method: PaymentMethod.CASH,
    source: input.source,
    collectedBy: input.collectedBy,
    collectedAt: new Date(Date.now() - 5 * 86_400_000),
    status: input.status,
    postedAt: input.status === PaymentStatus.POSTED ? new Date() : undefined,
    postedBy: input.status === PaymentStatus.POSTED ? manager._id : undefined,
    receiptReference: input.status === PaymentStatus.POSTED ? `RCP-FIN-${input.index}` : undefined,
    receivedBy: manager._id,
    idempotencyKey: `finance-fixture-${input.index}`,
    requestFingerprint: `fingerprint-${input.index}`,
  });
  return created._id;
}

before(async () => {
  memoryReplica = await MongoMemoryReplSet.create({
    replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
  });
  await mongoose.connect(memoryReplica.getUri('medsupply_finance'));
  await mongoose.connection.dropDatabase();
  await Promise.all([
    Invoice.init(),
    LedgerTransaction.init(),
    Payment.init(),
    PaymentAttachment.init(),
    Shop.init(),
    User.init(),
  ]);

  await User.create(
    (
      [
        [admin, 'finance-admin', 'Finance', 'Admin'],
        [manager, 'finance-manager', 'Finance', 'Manager'],
        [owner, 'finance-owner', 'Shop', 'Owner'],
        [otherOwner, 'finance-other-owner', 'Other', 'Owner'],
        [rider, 'finance-rider', 'Delivery', 'Rider'],
        [storekeeper, 'finance-storekeeper', 'Store', 'Keeper'],
      ] as const
    ).map(([who, email, firstName, lastName]) => ({
      _id: who._id,
      email: `${email}@test.local`,
      passwordHash: 'x',
      firstName,
      lastName,
      role: who.role,
      status: UserStatus.ACTIVE,
    })),
  );

  shop = await makeShop(1, 'Bismillah Pharmacy', [owner._id], 5_000_00);
  otherShop = await makeShop(2, 'Rahman Medicos', [otherOwner._id], 2_000_00);

  // Overdue by a month, so it appears in the overdue report as well as the
  // outstanding one — two reports that must agree about the same invoice.
  invoice = await makeInvoice(1, shop, 5_000_00, new Date(Date.now() - 30 * 86_400_000));
  otherInvoice = await makeInvoice(2, otherShop, 2_000_00, new Date(Date.now() + 30 * 86_400_000));

  await postEntry({
    shopId: shop,
    invoiceId: invoice,
    type: LedgerTransactionType.INVOICE_CHARGE,
    debitMinor: 5_000_00,
    creditMinor: 0,
    deltaMinor: 5_000_00,
  });
  await postEntry({
    shopId: otherShop,
    invoiceId: otherInvoice,
    type: LedgerTransactionType.INVOICE_CHARGE,
    debitMinor: 2_000_00,
    creditMinor: 0,
    deltaMinor: 2_000_00,
  });

  pendingPayment = await makePayment({
    index: 1,
    shopId: shop,
    invoiceId: invoice,
    amountMinor: 1_000_00,
    status: PaymentStatus.PENDING,
    source: PaymentSource.MANUAL,
  });
  /*
   * The attachment is looked up by `paymentId`, not through `attachmentId` on
   * the payment — which is just as well, because `Payment` refuses query-level
   * mutation outright (`PAYMENT_ACTION_REQUIRED`). A financial record may only
   * be changed by a financial action, and that includes from a test fixture.
   */
  const data = Buffer.from('deposit-slip-bytes');
  await PaymentAttachment.create({
    paymentId: pendingPayment,
    fileName: 'slip.png',
    mimeType: 'image/png',
    sizeBytes: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
    data,
    uploadedBy: manager._id,
  });

  foreignPayment = await makePayment({
    index: 2,
    shopId: otherShop,
    invoiceId: otherInvoice,
    amountMinor: 500_00,
    status: PaymentStatus.POSTED,
    source: PaymentSource.MANUAL,
  });
  riderCollection = await makePayment({
    index: 3,
    shopId: shop,
    amountMinor: 250_00,
    status: PaymentStatus.POSTED,
    source: PaymentSource.DELIVERY_COLLECTION,
    collectedBy: rider._id,
  });
  officeCollection = await makePayment({
    index: 4,
    shopId: shop,
    amountMinor: 750_00,
    status: PaymentStatus.POSTED,
    source: PaymentSource.MANUAL,
    collectedBy: rider._id,
  });

  await new Promise<void>((resolve) => {
    const running = app.listen(0, '127.0.0.1', () => {
      const address = running.address();
      if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
    server = running;
  });
});

after(async () => {
  server?.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await memoryReplica?.stop();
});

// ─── Reading payments ────────────────────────────────────────────────────────

test('the payment list gives each role only the payments that are theirs', async () => {
  const desk = await get('/api/v1/payments?limit=100', manager);
  assert.equal(desk.status, 200);
  const deskReferences = (desk.body.data as unknown as { reference: string }[]).map(
    (row) => row.reference,
  );
  assert.ok(deskReferences.includes('PAY-FIN-000001'), 'the desk sees every shop');
  assert.ok(deskReferences.includes('PAY-FIN-000002'));

  const customer = await get('/api/v1/payments?limit=100', owner);
  assert.equal(customer.status, 200);
  const customerReferences = (customer.body.data as unknown as { reference: string }[]).map(
    (row) => row.reference,
  );
  assert.ok(customerReferences.includes('PAY-FIN-000001'), 'their own payment is there');
  assert.equal(
    customerReferences.includes('PAY-FIN-000002'),
    false,
    'another customer’s payment is not, which is the only thing this endpoint must never get wrong',
  );
});

test('a rider sees what they collected at the door and not what the office booked to them', async () => {
  /*
   * The rule nobody would notice being wrong. A rider's filter is
   * `collectedBy` **and** `source: DELIVERY_COLLECTION` — drop the second half
   * and it still looks correct, because both fixtures name the same rider. The
   * difference is that an office payment somebody recorded against a rider's
   * name is the office's record, not the rider's cash position, and the rider's
   * screen adds these up as money they are holding.
   */
  const collected = await get('/api/v1/payments?limit=100', rider);
  assert.equal(collected.status, 200);
  const references = (collected.body.data as unknown as { reference: string }[]).map(
    (row) => row.reference,
  );
  assert.deepEqual(references.sort(), ['PAY-FIN-000003']);
  assert.equal(String(riderCollection).length, 24);
  assert.equal(
    references.includes('PAY-FIN-000004'),
    false,
    'an office payment recorded against the rider is not money in the rider’s bag',
  );
});

test('one payment is readable by its own customer and invisible to another', async () => {
  const mine = await get(`/api/v1/payments/${pendingPayment}`, owner);
  assert.equal(mine.status, 200);
  assert.equal((mine.body.data as unknown as { reference: string }).reference, 'PAY-FIN-000001');

  const theirs = await get(`/api/v1/payments/${foreignPayment}`, owner);
  assert.equal(
    theirs.status,
    404,
    'not 403 — a refusal that distinguishes "not yours" from "does not exist" confirms ' +
      'the payment exists, which is itself a disclosure',
  );

  const storeroom = await get(`/api/v1/payments/${pendingPayment}`, storekeeper);
  assert.equal(storeroom.status, 403, 'the warehouse has no business in the payment record');
});

test('a deposit slip is scoped exactly as tightly as the payment it belongs to', async () => {
  const mine = await get(`/api/v1/payments/${pendingPayment}/attachment`, owner);
  assert.equal(mine.status, 200);
  assert.match(mine.contentType, /image\/png/);
  assert.equal(mine.text, 'deposit-slip-bytes');

  const theirs = await get(`/api/v1/payments/${pendingPayment}/attachment`, otherOwner);
  assert.equal(
    theirs.status,
    404,
    'the file is the evidence behind the payment; reaching it must not be easier than ' +
      'reaching the payment',
  );
});

test('a rider’s own collection summary is their own', async () => {
  const summary = await get('/api/v1/payments/my-collections', rider);
  assert.equal(summary.status, 200);

  const desk = await get('/api/v1/payments/my-collections', manager);
  assert.equal(desk.status, 403, 'this endpoint answers "what am I holding", so only a rider asks');

  const history = await get('/api/v1/finance/my/collections', rider);
  assert.equal(history.status, 200);
  const customer = await get('/api/v1/finance/my/collections', owner);
  assert.equal(
    customer.status,
    403,
    '`/finance/my/collections` sits among the shop owner’s endpoints and belongs to a ' +
      'rider — a path prefix that reads as ownership and is not',
  );
});

// ─── Changing a payment ──────────────────────────────────────────────────────

test('a pending payment can be failed, once, and the reason is kept', async () => {
  const refused = await post(`/api/v1/payments/${pendingPayment}/fail`, storekeeper, {
    idempotencyKey: 'finance-fail-attempt-1',
    reason: 'Cheque bounced',
  });
  assert.equal(refused.status, 403);

  const failed = await post(`/api/v1/payments/${pendingPayment}/fail`, manager, {
    idempotencyKey: 'finance-fail-attempt-1',
    reason: 'Cheque bounced',
  });
  assert.equal(failed.status, 200);

  const stored = await Payment.findById(pendingPayment).lean();
  assert.equal(stored!.status, PaymentStatus.FAILED);
  assert.equal(stored!.failureReason, 'Cheque bounced');

  /*
   * The rule worth asserting, and it is not the status code.
   *
   * `failPayment` short-circuits on `status === FAILED` **before** it looks at
   * the idempotency key, so a second call with a different key and a different
   * reason is answered 200 rather than refused. That is the right answer — the
   * payment is failed, and saying so is more useful than a 409 — but it means
   * the protection people would assume comes from the key actually comes from
   * the state. What must be true is that the record does not move: the reason a
   * payment failed is what a customer is told and what an auditor reads, and a
   * later caller must not be able to rewrite it by trying again with a new key.
   */
  const again = await post(`/api/v1/payments/${pendingPayment}/fail`, manager, {
    idempotencyKey: 'finance-fail-attempt-2',
    reason: 'Actually the customer paid cash',
  });
  assert.equal(again.status, 200);
  assert.equal(
    (again.body.meta as unknown as { idempotentReplay: boolean }).idempotentReplay,
    true,
    'answered as a replay, so the caller is told nothing new happened',
  );

  const after = await Payment.findById(pendingPayment).lean();
  assert.equal(
    after!.failureReason,
    'Cheque bounced',
    'the second reason did not overwrite the first',
  );
  assert.equal(after!.failureIdempotencyKey, 'finance-fail-attempt-1');
});

// ─── What a customer sees about themselves ───────────────────────────────────

test('a customer’s own finance screens show their shop and only their shop', async () => {
  const summary = await get('/api/v1/finance/my/summary', owner);
  assert.equal(summary.status, 200);

  const invoices = await get('/api/v1/finance/my/invoices?limit=50', owner);
  assert.equal(invoices.status, 200);
  const references = (invoices.body.data as unknown as { reference: string }[]).map(
    (row) => row.reference,
  );
  assert.ok(references.includes('INV-FIN-000001'));
  assert.equal(
    references.includes('INV-FIN-000002'),
    false,
    'another shop’s invoice is not theirs',
  );

  const statement = await get('/api/v1/finance/my/statement', owner);
  assert.equal(statement.status, 200);

  for (const path of [
    '/api/v1/finance/my/summary',
    '/api/v1/finance/my/invoices',
    '/api/v1/finance/my/statement',
  ]) {
    const desk = await get(path, manager);
    assert.equal(desk.status, 403, `${path} is the customer's own view, not the desk's`);
  }
});

// ─── What the desk sees about a customer ─────────────────────────────────────

test('the desk can open one customer’s invoices and ledger, and a customer cannot', async () => {
  const invoices = await get(`/api/v1/finance/shops/${shop}/invoices?limit=50`, manager);
  assert.equal(invoices.status, 200);
  assert.ok(
    (invoices.body.data as unknown as { reference: string }[]).some(
      (row) => row.reference === 'INV-FIN-000001',
    ),
  );

  const ledger = await get(`/api/v1/finance/shops/${shop}/ledger?limit=50`, manager);
  assert.equal(ledger.status, 200);
  assert.ok(
    (ledger.body.data as unknown as { reference: string }[]).some((row) =>
      row.reference.startsWith('LED-FIN-'),
    ),
    'the ledger endpoint returns ledger entries rather than an empty envelope',
  );

  const customer = await get(`/api/v1/finance/shops/${otherShop}/ledger`, owner);
  assert.equal(
    customer.status,
    403,
    'a customer reaching another customer’s ledger by id is the worst failure this area has',
  );
});

test('the four receivables reports agree with each other about the same invoice', async () => {
  /*
   * The specific rule: an invoice 30 days past its due date is outstanding
   * **and** overdue, and both figures come from the same ledger. Two reports
   * disagreeing about one invoice is exactly the defect the settlement work
   * found the last time — a credit note that reduced the ageing report and not
   * the credit check.
   */
  const summary = await get('/api/v1/finance/reports/summary', manager);
  const outstanding = await get('/api/v1/finance/reports/outstanding', manager);
  const overdue = await get('/api/v1/finance/reports/overdue', manager);
  const collections = await get('/api/v1/finance/reports/collections', manager);

  for (const [name, response] of [
    ['summary', summary],
    ['outstanding', outstanding],
    ['overdue', overdue],
    ['collections', collections],
  ] as const) {
    assert.equal(response.status, 200, `${name} report`);
  }

  const rows = (name: string, response: { body: Record<string, never> }) => {
    const data = response.body.data as unknown;
    const list = Array.isArray(data)
      ? data
      : ((data as { rows?: unknown[]; items?: unknown[] })?.rows ??
        (data as { items?: unknown[] })?.items ??
        []);
    return list as { shopId?: string; shop?: { _id?: string } }[];
  };

  const names = (response: { body: Record<string, never> }) =>
    rows('row', response).map((row) => String(row.shopId ?? row.shop?._id ?? ''));

  assert.ok(
    names(outstanding).includes(String(shop)),
    'the shop carrying an unpaid invoice is in the outstanding report',
  );
  assert.ok(
    names(overdue).includes(String(shop)),
    'and in the overdue report, because the same invoice is 30 days past due',
  );

  const refused = await get('/api/v1/finance/reports/outstanding', owner);
  assert.equal(refused.status, 403);
});

// ─── Repairing the ledger ────────────────────────────────────────────────────

test('reconciliation reports the drift it finds, and only an administrator may repair it', async () => {
  /*
   * The cached `outstandingBalance` on the shop is a projection of the ledger.
   * It is what the credit check reads, so when the two disagree the business
   * either refuses an order it should take or takes one it should refuse.
   *
   * The fixture puts them 5,000.00 apart deliberately: the shop was created
   * carrying a balance and then the ledger was written, so the projection is
   * stale in exactly the way a crashed transaction leaves it.
   */
  await Shop.updateOne({ _id: shop }, { $set: { outstandingBalance: 9_999_00 } });

  const before = await get(`/api/v1/finance/reconciliation/${shop}`, manager);
  assert.equal(before.status, 200);
  const found = before.body.data as unknown as {
    ledgerBalanceMinor: number;
    cachedBalanceMinor: number;
    projectionDifferenceMinor: number;
  };
  assert.equal(found.cachedBalanceMinor, 9_999_00);
  assert.equal(found.ledgerBalanceMinor, 5_000_00);
  assert.equal(found.projectionDifferenceMinor, 9_999_00 - 5_000_00);

  const stillStale = await Shop.findById(shop).lean();
  assert.equal(
    stillStale!.outstandingBalance,
    9_999_00,
    'reading the reconciliation must not repair it — a report that silently fixes what ' +
      'it measures can never show you the same problem twice',
  );

  const byManager = await post(`/api/v1/finance/reconciliation/${shop}/repair`, manager, {});
  assert.equal(
    byManager.status,
    403,
    'a repair rewrites the record the business is audited against, so it is not a ' +
      'manager’s to make',
  );

  const repaired = await post(`/api/v1/finance/reconciliation/${shop}/repair`, admin, {});
  assert.equal(repaired.status, 200);
  assert.equal(
    (repaired.body.data as unknown as { repairedProjection: boolean }).repairedProjection,
    true,
  );

  const fixed = await Shop.findById(shop).lean();
  assert.equal(fixed!.outstandingBalance, 5_000_00, 'the projection now matches the ledger');
});

test('an adjustment moves the ledger by exactly what it says, in integer minor units', async () => {
  const before = await LedgerTransaction.countDocuments({ shopId: shop });

  const refused = await post('/api/v1/finance/adjustments', manager, {
    shopId: String(shop),
    type: LedgerTransactionType.CREDIT_ADJUSTMENT,
    amountMinor: 1_234_56,
    description: 'Goodwill credit',
    idempotencyKey: 'finance-adjustment-1',
  });
  assert.equal(refused.status, 403, 'posting to the ledger by hand is an administrator’s act');

  const posted = await post('/api/v1/finance/adjustments', admin, {
    shopId: String(shop),
    type: LedgerTransactionType.CREDIT_ADJUSTMENT,
    amountMinor: 1_234_56,
    description: 'Goodwill credit',
    idempotencyKey: 'finance-adjustment-1',
  });
  assert.equal(posted.status, 201, JSON.stringify(posted.body));

  assert.equal(await LedgerTransaction.countDocuments({ shopId: shop }), before + 1);
  const shopAfter = await Shop.findById(shop).lean();
  assert.equal(
    shopAfter!.outstandingBalance,
    5_000_00 - 1_234_56,
    'a credit adjustment of ৳1,234.56 reduces the balance by 123456 poisha and not a ' +
      'rounded approximation of it',
  );

  /*
   * The key is the whole point of the field. A retried adjustment on a flaky
   * connection must not credit the customer twice.
   */
  const replay = await post('/api/v1/finance/adjustments', admin, {
    shopId: String(shop),
    type: LedgerTransactionType.CREDIT_ADJUSTMENT,
    amountMinor: 1_234_56,
    description: 'Goodwill credit',
    idempotencyKey: 'finance-adjustment-1',
  });
  assert.equal(replay.status, 200, 'a replay is acknowledged, not created again');
  assert.equal(await LedgerTransaction.countDocuments({ shopId: shop }), before + 1);
  const unchanged = await Shop.findById(shop).lean();
  assert.equal(unchanged!.outstandingBalance, 5_000_00 - 1_234_56);
});

test('the fixtures mean what the assertions above assume', async () => {
  /*
   * The self-test. Every scoping claim in this file is of the form "X is absent
   * from Y" — which passes just as well when the fixture was never created, the
   * shop id is wrong, or the list is empty for an unrelated reason. This asserts
   * the other half: the records exist, and belong where the tests say.
   */
  assert.equal(await Payment.countDocuments({}), 4);
  assert.equal(await Payment.countDocuments({ shopId: otherShop }), 1);
  assert.equal(await Invoice.countDocuments({ shopId: otherShop }), 1);
  assert.equal(String(otherInvoice).length, 24);
  assert.equal(String(officeCollection).length, 24);

  const foreign = await get(`/api/v1/payments/${foreignPayment}`, manager);
  assert.equal(
    foreign.status,
    200,
    'the payment the customer could not see is genuinely there — otherwise that ' +
      'refusal proved nothing',
  );
});
