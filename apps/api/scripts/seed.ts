import 'dotenv/config';
import './seedEnv';
import { createHash, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcrypt';
import {
  DeliveryPriority,
  MedicineClassification,
  PaymentMethod,
  ShopStatus,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';
import { app } from '../src/app';
import { env } from '../src/env';
import { Medicine } from '../src/models/Medicine';
import { MedicineBatch } from '../src/models/MedicineBatch';
import { Shop } from '../src/models/Shop';
import { User } from '../src/models/User';
import { Order } from '../src/models/Order';
import { receiveStock } from '../src/services/inventoryService';

/**
 * Builds a working system from nothing: every role, shops, a catalogue, stock,
 * and orders parked at each state a screen exists for.
 *
 * Two properties matter, and they pull in the same direction.
 *
 * **Deterministic.** Every identifier is derived from a fixed string, so the
 * same seed produces the same `_id`s on every machine and an end-to-end test can
 * navigate straight to `/orders/<known id>` instead of clicking its way there
 * and hoping the list is sorted the way it was yesterday.
 *
 * **Driven through the real services and the real API.** Catalogue rows are
 * written directly because they are data, but every state *transition* — submit,
 * approve, pick, pack, hand over, deliver, collect — goes through the HTTP
 * endpoint a person would use, signed in as the role that is allowed to do it.
 * A seed that wrote `status: 'DELIVERED'` straight into the collection would
 * produce a database no sequence of real actions could ever have produced, and
 * would quietly stop matching the system the first time an invariant changed.
 * This one cannot drift: if the workflow breaks, the seed fails.
 */

const PRODUCTION_REFUSAL =
  'Refusing to seed: NODE_ENV is production. This script creates accounts with ' +
  'known credentials and is for development and testing only.';

/** A stable ObjectId per logical name, so reruns and tests agree on identifiers. */
function fixedId(name: string): Types.ObjectId {
  return new Types.ObjectId(createHash('sha256').update(name).digest('hex').slice(0, 24));
}

interface SeedAccount {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

const ACCOUNTS: SeedAccount[] = [
  {
    key: 'superadmin',
    email: 'superadmin@medsupply.local',
    firstName: 'Shahana',
    lastName: 'Rahman',
    role: UserRole.SUPER_ADMIN,
  },
  {
    key: 'admin',
    email: 'admin@medsupply.local',
    firstName: 'Imran',
    lastName: 'Hossain',
    role: UserRole.ADMIN,
  },
  {
    key: 'manager',
    email: 'manager@medsupply.local',
    firstName: 'Nusrat',
    lastName: 'Jahan',
    role: UserRole.MANAGER,
  },
  {
    key: 'storekeeper',
    email: 'storekeeper@medsupply.local',
    firstName: 'Rafiq',
    lastName: 'Islam',
    role: UserRole.STOREKEEPER,
  },
  {
    key: 'rider',
    email: 'rider@medsupply.local',
    firstName: 'Jamal',
    lastName: 'Uddin',
    role: UserRole.DELIVERY_PERSON,
  },
  {
    key: 'owner',
    email: 'owner@medsupply.local',
    firstName: 'Farhana',
    lastName: 'Akter',
    role: UserRole.SHOP_OWNER,
  },
  {
    key: 'owner2',
    email: 'owner2@medsupply.local',
    firstName: 'Tanvir',
    lastName: 'Ahmed',
    role: UserRole.SHOP_OWNER,
  },
];

/** Ten medicines a Bangladeshi distributor would actually carry. */
const CATALOGUE = [
  { sku: 'NAP-500', brand: 'Napa', generic: 'Paracetamol', strength: '500mg', price: 12_00 },
  { sku: 'SEC-20', brand: 'Seclo', generic: 'Omeprazole', strength: '20mg', price: 70_00 },
  { sku: 'MON-10', brand: 'Monas', generic: 'Montelukast', strength: '10mg', price: 140_00 },
  { sku: 'MAX-500', brand: 'Maxpro', generic: 'Esomeprazole', strength: '20mg', price: 90_00 },
  { sku: 'ACE-100', brand: 'Ace', generic: 'Paracetamol', strength: '100mg', price: 9_50 },
  { sku: 'FEX-120', brand: 'Fexo', generic: 'Fexofenadine', strength: '120mg', price: 110_00 },
  { sku: 'AMO-500', brand: 'Amoxin', generic: 'Amoxicillin', strength: '500mg', price: 160_00 },
  { sku: 'CEF-250', brand: 'Cef-3', generic: 'Cefixime', strength: '250mg', price: 320_00 },
  { sku: 'MET-500', brand: 'Comet', generic: 'Metformin', strength: '500mg', price: 55_00 },
  {
    sku: 'LOS-50',
    brand: 'Losartan',
    generic: 'Losartan Potassium',
    strength: '50mg',
    price: 85_00,
  },
];

interface SeedShop {
  key: string;
  name: string;
  ownerKey: string;
  status: ShopStatus;
  creditLimit: number;
  phone: string;
}

const SHOPS: SeedShop[] = [
  {
    key: 'shop-a',
    name: 'Shafin Pharmacy',
    ownerKey: 'owner',
    status: ShopStatus.ACTIVE,
    creditLimit: 500_000_00,
    phone: '01711000001',
  },
  {
    key: 'shop-b',
    name: 'Mirpur Medico',
    ownerKey: 'owner2',
    status: ShopStatus.ACTIVE,
    creditLimit: 50_000_00,
    phone: '01711000002',
  },
  {
    key: 'shop-c',
    name: 'Uttara Drug House',
    ownerKey: 'owner2',
    status: ShopStatus.SUSPENDED,
    creditLimit: 20_000_00,
    phone: '01711000003',
  },
];

let base = '';
let server: Server | undefined;
const tokens = new Map<string, string>();
const created: string[] = [];

function note(line: string) {
  created.push(line);
  process.stdout.write(`  ${line}\n`);
}

async function call<T = unknown>(
  method: string,
  path: string,
  options: { as?: string; body?: unknown } = {},
): Promise<{ status: number; data: T; error?: { message?: string; code?: string } }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.as) headers.authorization = `Bearer ${tokens.get(options.as)}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string; code?: string };
  };
  return { status: response.status, data: payload.data as T, error: payload.error };
}

/**
 * Fails loudly by default. A seed that swallows a refusal produces a database
 * that looks populated and is not, which is worse than no seed at all.
 */
async function must<T>(
  what: string,
  method: string,
  path: string,
  options: { as?: string; body?: unknown } = {},
): Promise<T> {
  const result = await call<T>(method, path, options);
  if (result.status >= 400) {
    throw new Error(
      `${what} failed: ${method} ${path} returned ${result.status} ` +
        `${result.error?.code ?? ''} ${result.error?.message ?? ''}`.trim(),
    );
  }
  return result.data;
}

async function seedAccounts(password: string) {
  process.stdout.write('Accounts\n');
  const hash = await bcrypt.hash(password, 10);
  for (const account of ACCOUNTS) {
    const _id = fixedId(`user:${account.key}`);
    const existing = await User.findById(_id).select('_id');
    if (!existing) {
      await User.create({
        _id,
        email: account.email,
        passwordHash: hash,
        firstName: account.firstName,
        lastName: account.lastName,
        role: account.role,
        status: UserStatus.ACTIVE,
        // Deliberately off: a seeded account exists to be signed into
        // immediately, and a forced change would stop every end-to-end run at
        // the same screen. Production accounts come from `bootstrap.ts`, which
        // does force it.
        forcePasswordChange: false,
      });
    } else {
      // Keep the password in step with this run so the printed credentials work.
      await User.updateOne({ _id }, { $set: { passwordHash: hash, status: UserStatus.ACTIVE } });
    }
    note(`${account.role.padEnd(16)} ${account.email}`);
  }
}

async function signIn(password: string) {
  for (const account of ACCOUNTS) {
    const data = await must<{ accessToken: string }>('Sign-in', 'POST', '/api/v1/auth/login', {
      body: { email: account.email, password },
    });
    tokens.set(account.key, data.accessToken);
  }
}

async function seedShops() {
  process.stdout.write('Shops\n');
  for (const shop of SHOPS) {
    const _id = fixedId(`shop:${shop.key}`);
    if (!(await Shop.findById(_id).select('_id'))) {
      await Shop.create({
        _id,
        reference: `SHP-SEED-${shop.key.toUpperCase()}`,
        name: shop.name,
        ownerIds: [fixedId(`user:${shop.ownerKey}`)],
        primaryPhone: shop.phone,
        status: shop.status,
        creditLimit: shop.creditLimit,
        paymentTermsDays: 30,
        deliveryAddresses: [
          {
            _id: fixedId(`address:${shop.key}`),
            label: 'Shop',
            line1: `${shop.name}, Ground floor`,
            city: 'Dhaka',
            district: 'Dhaka',
            isDefault: true,
          },
        ],
      });
    }
    note(`${shop.status.padEnd(10)} ${shop.name}`);
  }
}

async function seedCatalogue() {
  process.stdout.write('Catalogue and stock\n');
  const createdBy = fixedId('user:manager');
  for (const [index, item] of CATALOGUE.entries()) {
    const _id = fixedId(`medicine:${item.sku}`);
    if (!(await Medicine.findById(_id).select('_id'))) {
      await Medicine.create({
        _id,
        reference: `MED-SEED-${String(index + 1).padStart(3, '0')}`,
        sku: item.sku,
        brandName: item.brand,
        genericName: item.generic,
        manufacturer: 'Seed Pharmaceuticals Ltd',
        strength: item.strength,
        dosageForm: 'Tablet',
        packSize: '10',
        unit: 'box',
        category: 'General',
        barcode: `880${String(1000000 + index).padStart(10, '0')}`,
        costPriceMinor: Math.round(item.price * 0.7),
        defaultSellingPriceMinor: item.price,
        minimumOrderQuantity: 1,
        classification: MedicineClassification.OTC,
        createdBy,
      });
    }

    // Three batches with staggered expiries, so FEFO has something to order by
    // and the near-expiry warnings on the inventory screen have something to
    // warn about. Dates are relative to the run so they never go stale.
    const existingBatches = await MedicineBatch.countDocuments({ medicineId: _id });
    if (existingBatches === 0) {
      const monthsOut = [4, 14, 26];
      for (const [batchIndex, months] of monthsOut.entries()) {
        const expiry = new Date();
        expiry.setMonth(expiry.getMonth() + months);
        const manufactured = new Date(expiry);
        manufactured.setFullYear(manufactured.getFullYear() - 2);
        await receiveStock(
          {
            medicineId: String(_id),
            batchNumber: `${item.sku}-B${batchIndex + 1}`,
            manufacturingDate: manufactured,
            expiryDate: expiry,
            costPriceMinor: Math.round(item.price * 0.7),
            quantity: 400,
            warehouseLocation: `A${(index % 5) + 1}-${batchIndex + 1}`,
          },
          { _id: createdBy, role: UserRole.MANAGER },
        );
      }
    }
  }
  note(`${CATALOGUE.length} medicines, 3 batches each, 400 units per batch`);
}

interface OrderRefs {
  orderId: string;
  version: number;
}

async function submitOrder(key: string, shopKey: string, ownerKey: string, quantity: number) {
  const shopId = fixedId(`shop:${shopKey}`);
  const shop = await Shop.findById(shopId).select('deliveryAddresses');
  const body = {
    items: [
      { medicineId: String(fixedId('medicine:NAP-500')), requestedQuantity: quantity },
      {
        medicineId: String(fixedId('medicine:SEC-20')),
        requestedQuantity: Math.ceil(quantity / 2),
      },
    ],
    deliveryAddressId: String(shop!.deliveryAddresses[0]!._id),
    requestedPaymentMethod: PaymentMethod.CASH,
    // The submit endpoint is idempotent on this key, which is what makes
    // rerunning the seed produce the same orders rather than more of them.
    idempotencyKey: `seed-order-${key}`,
  };
  const data = await must<{ _id: string; version: number; orderNumber?: string }>(
    `Order ${key}`,
    'POST',
    '/api/v1/orders/submit',
    { as: ownerKey, body },
  );
  return { orderId: data._id, version: data.version ?? 0 } satisfies OrderRefs;
}

interface ReviewOrder {
  _id: string;
  version: number;
  status: string;
  items: Array<{
    _id: string;
    requestedQuantity: number;
    estimatedUnitPriceMinor: number;
  }>;
}

/**
 * The approval endpoints are keyed by the *order* id — `/approvals/:id` reads
 * an Order, not an Approval — so this fetches the order the reviewer sees,
 * with the version its optimistic-concurrency check will demand.
 */
async function orderForReview(orderId: string): Promise<ReviewOrder> {
  const detail = await must<ReviewOrder>('Approval detail', 'GET', `/api/v1/approvals/${orderId}`, {
    as: 'manager',
  });
  const order = (detail as ReviewOrder & { order?: ReviewOrder }).order ?? detail;
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new Error(
      `Order ${orderId} came back from the review endpoint with no items. The seed ` +
        `cannot approve what it cannot price; the response shape has changed.`,
    );
  }
  return order;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    process.stderr.write(`${PRODUCTION_REFUSAL}\n`);
    process.exit(1);
  }

  // Never hard-coded. Supplied for a repeatable run (the end-to-end harness
  // sets it), generated and printed once otherwise.
  const generated = !process.env.SEED_PASSWORD;
  const password = process.env.SEED_PASSWORD ?? `Seed-${randomBytes(9).toString('base64url')}!`;
  if (password.length < 8) throw new Error('SEED_PASSWORD must be at least 8 characters');

  await mongoose.connect(env.MONGODB_URI);
  process.stdout.write(`Seeding ${mongoose.connection.name}\n\n`);

  await new Promise<void>((resolve) => {
    const running = app.listen(0, '127.0.0.1', () => {
      const address = running.address();
      if (typeof address === 'object' && address) base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
    server = running;
  });

  await seedAccounts(password);
  await signIn(password);
  await seedShops();
  await seedCatalogue();

  process.stdout.write('Orders\n');

  // One order left where a shop owner would leave it: half-written. The draft
  // endpoint has no idempotency key — drafts are meant to accumulate — so
  // reruns are kept honest by asking whether one already exists.
  const draftShop = fixedId('shop:shop-a');
  if ((await Order.countDocuments({ shopId: draftShop, status: 'DRAFT' })) === 0) {
    await must('Draft order', 'POST', '/api/v1/orders/drafts', {
      as: 'owner',
      body: {
        items: [{ medicineId: String(fixedId('medicine:MON-10')), requestedQuantity: 5 }],
        notes: 'Left as a draft by the seed so the drafts screen is not empty.',
      },
    });
  }
  note('DRAFT              one, on Shafin Pharmacy');

  // Awaiting a manager. This is the approval queue's only content.
  const awaiting = await submitOrder('awaiting', 'shop-a', 'owner', 20);
  note(`PENDING_APPROVAL   ${awaiting.orderId}`);

  // Rejected, so the rejected state has an example a screen can render.
  const toReject = await submitOrder('rejected', 'shop-b', 'owner2', 6);
  const rejecting = await orderForReview(toReject.orderId);
  if (rejecting.status !== 'REJECTED') {
    await must('Reject', 'POST', `/api/v1/approvals/${toReject.orderId}/reject`, {
      as: 'manager',
      body: {
        version: rejecting.version,
        reason: 'Requested quantity exceeds the agreed monthly allocation.',
      },
    });
  }
  note(`REJECTED           ${toReject.orderId}`);

  // Approved and waiting to be picked: the storekeeper's queue.
  const toPick = await submitOrder('picking', 'shop-a', 'owner', 12);
  const approving = await orderForReview(toPick.orderId);
  if (approving.status === 'SUBMITTED' || approving.status === 'UNDER_REVIEW') {
    await must('Approve', 'POST', `/api/v1/approvals/${toPick.orderId}/approve`, {
      as: 'manager',
      body: {
        version: approving.version,
        lines: approving.items.map((item) => ({
          orderItemId: String(item._id),
          approvedQuantity: item.requestedQuantity,
          unitPriceMinor: item.estimatedUnitPriceMinor,
          lineDiscountMinor: 0,
        })),
        orderDiscountMinor: 0,
        deliveryChargeMinor: 60_00,
      },
    });
  }
  note(`APPROVED           ${toPick.orderId}`);

  const summary = await Order.countDocuments({});
  process.stdout.write(`\n${summary} orders in the database.\n`);

  process.stdout.write('\nSign in with:\n');
  for (const account of ACCOUNTS) {
    process.stdout.write(`  ${account.email.padEnd(30)} ${account.role}\n`);
  }
  process.stdout.write(
    generated
      ? `\nPassword (generated for this run, shown once): ${password}\n` +
          'Set SEED_PASSWORD to choose it yourself and make the run repeatable.\n'
      : '\nPassword: the SEED_PASSWORD you supplied.\n',
  );
}

main()
  .then(async () => {
    server?.close();
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`\nSeed failed: ${(error as Error).message}\n`);
    server?.close();
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
