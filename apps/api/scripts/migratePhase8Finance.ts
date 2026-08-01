import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MigrationRun, MigrationRunMode, MigrationRunStatus } from '../src/models/MigrationRun';

const MIGRATION_ID = 'phase8-finance-foundation-v1';
const LEGACY_MOBILE_METHOD = 'MOBILE_BANKING';
const CANONICAL_MOBILE_METHOD = 'MOBILE_FINANCIAL_SERVICE';
const MAX_RECORDED_ANOMALIES = 500;

type Database = NonNullable<(typeof mongoose.connection)['db']>;
type Severity = 'INFO' | 'WARNING' | 'BLOCKER';

type MigrationAnomaly = {
  severity: Severity;
  code: string;
  entityType: string;
  entityId: string;
  message: string;
};

type FinanceScan = {
  scannedAt: string;
  collections: Record<string, boolean>;
  legacyOpeningBalances: number;
  legacyOpeningBalanceMinor: string;
  issuedInvoicesMissingLedger: number;
  issuedInvoiceChargeMinor: string;
  invoicesWithLegacyPaidAmount: number;
  legacyInvoicePaidMinor: string;
  pendingDeliveryCollectionsMissingPayment: number;
  pendingDeliveryCollectionMinor: string;
  approvedCreditOrdersMissingReservation: number;
  legacyMethodDocuments: number;
  blockerCount: number;
  recordedAnomalyCount: number;
  truncatedAnomalyCount: number;
  financeBackfillDeferred: true;
  anomalies: MigrationAnomaly[];
};

type CanonicalisationResult = {
  deliveriesModified: number;
  ordersModified: number;
  paymentsModified: number;
};

function objectId(value: unknown) {
  return value instanceof mongoose.Types.ObjectId ? String(value) : String(value ?? 'unknown');
}

function safeMoney(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function addMoney(total: bigint, value: unknown) {
  return safeMoney(value) ? total + BigInt(value as number) : total;
}

async function collectionMap(database: Database) {
  const names = new Set(
    (await database.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name),
  );
  return {
    shops: names.has('shops'),
    invoices: names.has('invoices'),
    deliveries: names.has('deliveries'),
    orders: names.has('orders'),
    payments: names.has('payments'),
    ledgertransactions: names.has('ledgertransactions'),
    creditreservations: names.has('creditreservations'),
    orderapprovals: names.has('orderapprovals'),
  };
}

export async function scanPhase8Finance(database: Database): Promise<FinanceScan> {
  const collections = await collectionMap(database);
  const anomalies: MigrationAnomaly[] = [];
  let truncatedAnomalyCount = 0;
  let blockerCount = 0;
  const record = (anomaly: MigrationAnomaly) => {
    if (anomaly.severity === 'BLOCKER') blockerCount += 1;
    if (anomalies.length < MAX_RECORDED_ANOMALIES) anomalies.push(anomaly);
    else truncatedAnomalyCount += 1;
  };

  let legacyOpeningBalances = 0;
  let legacyOpeningBalanceMinor = 0n;
  if (collections.shops) {
    const cursor = database
      .collection('shops')
      .find(
        { outstandingBalance: { $ne: 0 } },
        { projection: { _id: 1, reference: 1, outstandingBalance: 1 } },
      );
    for await (const shop of cursor) {
      if (!safeMoney(shop.outstandingBalance)) {
        record({
          severity: 'BLOCKER',
          code: 'UNSAFE_LEGACY_OUTSTANDING',
          entityType: 'Shop',
          entityId: objectId(shop._id),
          message: 'Legacy outstanding balance is negative or not a safe integer.',
        });
        continue;
      }
      const alreadyPosted =
        collections.ledgertransactions &&
        (await database.collection('ledgertransactions').countDocuments({
          shopId: shop._id,
          type: 'OPENING_BALANCE',
        })) > 0;
      if (!alreadyPosted) {
        legacyOpeningBalances += 1;
        legacyOpeningBalanceMinor = addMoney(legacyOpeningBalanceMinor, shop.outstandingBalance);
        record({
          severity: 'WARNING',
          code: 'LEGACY_OPENING_BALANCE_REQUIRES_AUTHORISED_POSTING',
          entityType: 'Shop',
          entityId: objectId(shop._id),
          message: `Legacy balance for ${String(shop.reference ?? shop._id)} requires an authorised opening-balance journal.`,
        });
      }
    }
  }

  let issuedInvoicesMissingLedger = 0;
  let issuedInvoiceChargeMinor = 0n;
  let invoicesWithLegacyPaidAmount = 0;
  let legacyInvoicePaidMinor = 0n;
  if (collections.invoices) {
    const cursor = database.collection('invoices').find(
      { status: 'ISSUED' },
      {
        projection: {
          _id: 1,
          reference: 1,
          shopId: 1,
          grandTotalMinor: 1,
          amountPaidMinor: 1,
        },
      },
    );
    for await (const invoice of cursor) {
      if (!safeMoney(invoice.grandTotalMinor)) {
        record({
          severity: 'BLOCKER',
          code: 'UNSAFE_INVOICE_TOTAL',
          entityType: 'Invoice',
          entityId: objectId(invoice._id),
          message: 'Issued invoice grand total is not a safe non-negative integer.',
        });
        continue;
      }
      const hasCharge =
        collections.ledgertransactions &&
        (await database.collection('ledgertransactions').countDocuments({
          invoiceId: invoice._id,
          type: 'INVOICE_CHARGE',
        })) > 0;
      if (!hasCharge) {
        issuedInvoicesMissingLedger += 1;
        issuedInvoiceChargeMinor = addMoney(issuedInvoiceChargeMinor, invoice.grandTotalMinor);
        record({
          severity: 'WARNING',
          code: 'INVOICE_CHARGE_REQUIRES_AUTHORISED_POSTING',
          entityType: 'Invoice',
          entityId: objectId(invoice._id),
          message: `Invoice ${String(invoice.reference ?? invoice._id)} has no invoice-charge journal.`,
        });
      }
      if (invoice.amountPaidMinor !== undefined && invoice.amountPaidMinor !== 0) {
        if (!safeMoney(invoice.amountPaidMinor)) {
          record({
            severity: 'BLOCKER',
            code: 'UNSAFE_LEGACY_INVOICE_PAYMENT',
            entityType: 'Invoice',
            entityId: objectId(invoice._id),
            message: 'Legacy invoice paid amount is not a safe non-negative integer.',
          });
        } else {
          invoicesWithLegacyPaidAmount += 1;
          legacyInvoicePaidMinor = addMoney(legacyInvoicePaidMinor, invoice.amountPaidMinor);
          record({
            severity: 'BLOCKER',
            code: 'LEGACY_PAYMENT_REQUIRES_REVIEW',
            entityType: 'Invoice',
            entityId: objectId(invoice._id),
            message:
              'A non-zero legacy paid amount needs an authorised imported Payment; it will not be inferred automatically.',
          });
        }
      }
    }
  }

  let pendingDeliveryCollectionsMissingPayment = 0;
  let pendingDeliveryCollectionMinor = 0n;
  if (collections.deliveries) {
    const cursor = database.collection('deliveries').find(
      {
        'paymentCollection.status': 'PENDING_POSTING',
        'paymentCollection.amountMinor': { $gt: 0 },
      },
      {
        projection: {
          _id: 1,
          reference: 1,
          shopId: 1,
          invoiceId: 1,
          assignedTo: 1,
          'proof.deliveredAt': 1,
          paymentCollection: 1,
        },
      },
    );
    for await (const delivery of cursor) {
      const amount = delivery.paymentCollection?.amountMinor;
      if (!safeMoney(amount) || amount === 0) {
        record({
          severity: 'BLOCKER',
          code: 'UNSAFE_DELIVERY_COLLECTION',
          entityType: 'Delivery',
          entityId: objectId(delivery._id),
          message: 'Pending delivery collection is not a positive safe integer.',
        });
        continue;
      }
      const hasPayment =
        collections.payments &&
        (await database.collection('payments').countDocuments({ deliveryId: delivery._id })) > 0;
      if (!hasPayment) {
        pendingDeliveryCollectionsMissingPayment += 1;
        pendingDeliveryCollectionMinor = addMoney(pendingDeliveryCollectionMinor, amount);
        record({
          severity: 'WARNING',
          code: 'DELIVERY_COLLECTION_REQUIRES_AUTHORISED_IMPORT',
          entityType: 'Delivery',
          entityId: objectId(delivery._id),
          message: `Collection on ${String(delivery.reference ?? delivery._id)} requires an authorised pending Payment import.`,
        });
      }
    }
  }

  let legacyMethodDocuments = 0;
  if (collections.deliveries) {
    legacyMethodDocuments += await database.collection('deliveries').countDocuments({
      'paymentCollection.method': LEGACY_MOBILE_METHOD,
    });
  }
  if (collections.orders) {
    legacyMethodDocuments += await database
      .collection('orders')
      .countDocuments({ requestedPaymentMethod: LEGACY_MOBILE_METHOD });
  }
  if (collections.payments) {
    legacyMethodDocuments += await database
      .collection('payments')
      .countDocuments({ method: LEGACY_MOBILE_METHOD });
  }

  let approvedCreditOrdersMissingReservation = 0;
  if (collections.orders) {
    const cursor = database.collection('orders').find(
      {
        requestedPaymentMethod: 'CREDIT',
        status: {
          $in: ['APPROVED', 'PARTIALLY_APPROVED', 'PREPARING', 'PACKING', 'PACKED'],
        },
      },
      { projection: { _id: 1, reference: 1 } },
    );
    for await (const order of cursor) {
      const invoiced =
        collections.invoices &&
        (await database.collection('invoices').countDocuments({ orderId: order._id })) > 0;
      const reserved =
        collections.creditreservations &&
        (await database.collection('creditreservations').countDocuments({
          orderId: order._id,
          status: 'ACTIVE',
        })) > 0;
      if (!invoiced && !reserved) {
        approvedCreditOrdersMissingReservation += 1;
        record({
          severity: 'BLOCKER',
          code: 'APPROVED_CREDIT_ORDER_REQUIRES_RESERVATION',
          entityType: 'Order',
          entityId: objectId(order._id),
          message: `Approved credit Order ${String(order.reference ?? order._id)} must receive an authorised reservation before finance traffic is enabled.`,
        });
      }
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    collections,
    legacyOpeningBalances,
    legacyOpeningBalanceMinor: legacyOpeningBalanceMinor.toString(),
    issuedInvoicesMissingLedger,
    issuedInvoiceChargeMinor: issuedInvoiceChargeMinor.toString(),
    invoicesWithLegacyPaidAmount,
    legacyInvoicePaidMinor: legacyInvoicePaidMinor.toString(),
    pendingDeliveryCollectionsMissingPayment,
    pendingDeliveryCollectionMinor: pendingDeliveryCollectionMinor.toString(),
    approvedCreditOrdersMissingReservation,
    legacyMethodDocuments,
    blockerCount,
    recordedAnomalyCount: anomalies.length,
    truncatedAnomalyCount,
    financeBackfillDeferred: true,
    anomalies,
  };
}

async function canonicaliseLegacyMethods(
  database: Database,
  session: mongoose.ClientSession,
): Promise<CanonicalisationResult> {
  const collections = await collectionMap(database);
  const deliveries = collections.deliveries
    ? await database
        .collection('deliveries')
        .updateMany(
          { 'paymentCollection.method': LEGACY_MOBILE_METHOD },
          { $set: { 'paymentCollection.method': CANONICAL_MOBILE_METHOD } },
          { session },
        )
    : undefined;
  const orders = collections.orders
    ? await database
        .collection('orders')
        .updateMany(
          { requestedPaymentMethod: LEGACY_MOBILE_METHOD },
          { $set: { requestedPaymentMethod: CANONICAL_MOBILE_METHOD } },
          { session },
        )
    : undefined;
  const payments = collections.payments
    ? await database
        .collection('payments')
        .updateMany(
          { method: LEGACY_MOBILE_METHOD },
          { $set: { method: CANONICAL_MOBILE_METHOD } },
          { session },
        )
    : undefined;
  return {
    deliveriesModified: deliveries?.modifiedCount ?? 0,
    ordersModified: orders?.modifiedCount ?? 0,
    paymentsModified: payments?.modifiedCount ?? 0,
  };
}

function requestedMode() {
  const apply = process.argv.includes('--apply');
  const dryRun = process.argv.includes('--dry-run');
  if (apply && dryRun) throw new Error('Choose either --dry-run or --apply, not both.');
  return apply ? MigrationRunMode.APPLY : MigrationRunMode.DRY_RUN;
}

export async function runPhase8FinanceMigration() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required.');
  const mode = requestedMode();
  await mongoose.connect(uri);
  const database = mongoose.connection.db;
  if (!database) throw new Error('MongoDB connection did not expose a database.');

  if (mode === MigrationRunMode.DRY_RUN) {
    const scan = await scanPhase8Finance(database);
    process.stdout.write(`${JSON.stringify({ migrationId: MIGRATION_ID, mode, scan }, null, 2)}\n`);
    return;
  }

  await MigrationRun.init();
  const migrationRun = await MigrationRun.create({
    migrationId: MIGRATION_ID,
    runId: randomUUID(),
    mode,
    status: MigrationRunStatus.RUNNING,
    startedAt: new Date(),
  });
  try {
    const before = await scanPhase8Finance(database);
    const session = await mongoose.startSession();
    let canonicalisation: CanonicalisationResult | undefined;
    try {
      await session.withTransaction(async () => {
        canonicalisation = await canonicaliseLegacyMethods(database, session);
      });
    } finally {
      await session.endSession();
    }
    const after = await scanPhase8Finance(database);
    migrationRun.status = MigrationRunStatus.COMPLETED;
    migrationRun.completedAt = new Date();
    migrationRun.set('stats', { before, canonicalisation, after });
    migrationRun.set('anomalies', after.anomalies);
    await migrationRun.save();
    process.stdout.write(
      `${JSON.stringify(
        {
          migrationId: MIGRATION_ID,
          runId: migrationRun.runId,
          mode,
          canonicalisation,
          scan: after,
          note: 'Financial postings are intentionally deferred to an explicit authorised reconciliation action.',
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    migrationRun.status = MigrationRunStatus.FAILED;
    migrationRun.completedAt = new Date();
    migrationRun.error = error instanceof Error ? error.message : String(error);
    await migrationRun.save();
    throw error;
  }
}

if (require.main === module) {
  runPhase8FinanceMigration()
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
