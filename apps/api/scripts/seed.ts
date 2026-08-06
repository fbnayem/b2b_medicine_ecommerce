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
import { Invoice } from '../src/models/Invoice';
import { Supplier } from '../src/models/Supplier';
import { PurchaseOrder } from '../src/models/PurchaseOrder';
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

  /*
   * One account per new shop, because `ASSUMPTIONS.md` says a shop owner
   * belongs to **one** ordering shop and the submit endpoint means it: an order
   * is placed against the owner's shop, so an address belonging to their second
   * shop is refused with `ADDRESS_REQUIRED`. Hanging six shops off the two
   * existing owners looked tidier and could not place an order.
   */
  {
    key: 'owner3',
    email: 'gulshan@medsupply.local',
    firstName: 'Rumana',
    lastName: 'Kabir',
    role: UserRole.SHOP_OWNER,
  },
  {
    key: 'owner4',
    email: 'dhanmondi@medsupply.local',
    firstName: 'Shakil',
    lastName: 'Mahmud',
    role: UserRole.SHOP_OWNER,
  },
  {
    key: 'owner5',
    email: 'banani@medsupply.local',
    firstName: 'Nabila',
    lastName: 'Chowdhury',
    role: UserRole.SHOP_OWNER,
  },
  {
    key: 'owner6',
    email: 'mohakhali@medsupply.local',
    firstName: 'Arif',
    lastName: 'Hasan',
    role: UserRole.SHOP_OWNER,
  },
  {
    key: 'owner7',
    email: 'bashundhara@medsupply.local',
    firstName: 'Sadia',
    lastName: 'Noor',
    role: UserRole.SHOP_OWNER,
  },
  {
    key: 'owner8',
    email: 'savar@medsupply.local',
    firstName: 'Milon',
    lastName: 'Sarker',
    role: UserRole.SHOP_OWNER,
  },
];

interface SeedMedicine {
  sku: string;
  brand: string;
  generic: string;
  strength: string;
  price: number;
  form?: string;
  category?: string;
  prescription?: boolean;
  coldChain?: boolean;
}

/**
 * A catalogue a Bangladeshi distributor would actually carry.
 *
 * The first ten are the originals and keep their `MED-SEED-001…010` references,
 * because the browser suite and several screenshots name them. Everything after
 * is new, and it is deliberately not ten more paracetamols: the point of a
 * wider catalogue is to exercise the things a narrow one hides — searching,
 * paging past the first screenful, a prescription line that makes generic name
 * and strength mandatory, a cold-chain line, syrups and injections whose "sold
 * as" is not a box of ten, and prices spanning three orders of magnitude so a
 * money column has something to line up.
 */
const CATALOGUE: SeedMedicine[] = [
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

  // ── Pain, fever and inflammation ──────────────────────────────────────────
  {
    sku: 'NAP-EXT',
    brand: 'Napa Extra',
    generic: 'Paracetamol + Caffeine',
    strength: '500mg+65mg',
    price: 20_00,
    category: 'Painkillers',
  },
  {
    sku: 'ACE-PLUS',
    brand: 'Ace Plus',
    generic: 'Paracetamol + Caffeine',
    strength: '500mg+65mg',
    price: 18_00,
    category: 'Painkillers',
  },
  {
    sku: 'ETO-90',
    brand: 'Etorix',
    generic: 'Etoricoxib',
    strength: '90mg',
    price: 210_00,
    category: 'Painkillers',
  },
  {
    sku: 'DIC-50',
    brand: 'Voltalin',
    generic: 'Diclofenac Sodium',
    strength: '50mg',
    price: 45_00,
    category: 'Painkillers',
  },
  {
    sku: 'NAP-SYP',
    brand: 'Napa Syrup',
    generic: 'Paracetamol',
    strength: '120mg/5ml',
    price: 35_00,
    form: 'Syrup',
    category: 'Painkillers',
  },

  // ── Antibiotics, all prescription-only ────────────────────────────────────
  {
    sku: 'AZI-500',
    brand: 'Azithral',
    generic: 'Azithromycin',
    strength: '500mg',
    price: 285_00,
    category: 'Antibiotics',
    prescription: true,
  },
  {
    sku: 'CIP-500',
    brand: 'Ciprocin',
    generic: 'Ciprofloxacin',
    strength: '500mg',
    price: 190_00,
    category: 'Antibiotics',
    prescription: true,
  },
  {
    sku: 'FLU-150',
    brand: 'Flugal',
    generic: 'Fluconazole',
    strength: '150mg',
    price: 95_00,
    category: 'Antibiotics',
    prescription: true,
  },
  {
    sku: 'CEF-SYP',
    brand: 'Cef-3 Syrup',
    generic: 'Cefixime',
    strength: '100mg/5ml',
    price: 260_00,
    form: 'Syrup',
    category: 'Antibiotics',
    prescription: true,
  },
  {
    sku: 'CEFT-1G',
    brand: 'Roceph',
    generic: 'Ceftriaxone',
    strength: '1g',
    price: 340_00,
    form: 'Injection',
    category: 'Antibiotics',
    prescription: true,
  },

  // ── Long-term conditions ──────────────────────────────────────────────────
  {
    sku: 'AML-5',
    brand: 'Amlovas',
    generic: 'Amlodipine',
    strength: '5mg',
    price: 48_00,
    category: 'Heart and blood pressure',
  },
  {
    sku: 'ATE-50',
    brand: 'Atenol',
    generic: 'Atenolol',
    strength: '50mg',
    price: 40_00,
    category: 'Heart and blood pressure',
  },
  {
    sku: 'ATO-20',
    brand: 'Atorva',
    generic: 'Atorvastatin',
    strength: '20mg',
    price: 130_00,
    category: 'Heart and blood pressure',
  },
  {
    sku: 'CLO-75',
    brand: 'Clopid',
    generic: 'Clopidogrel',
    strength: '75mg',
    price: 175_00,
    category: 'Heart and blood pressure',
    prescription: true,
  },
  {
    sku: 'GLI-80',
    brand: 'Comet DS',
    generic: 'Gliclazide',
    strength: '80mg',
    price: 72_00,
    category: 'Diabetes',
  },
  {
    sku: 'LEV-50',
    brand: 'Thyrox',
    generic: 'Levothyroxine',
    strength: '50mcg',
    price: 88_00,
    category: 'Hormones',
    prescription: true,
  },

  // ── Cold chain ────────────────────────────────────────────────────────────
  {
    sku: 'INS-100',
    brand: 'Insulet 30/70',
    generic: 'Human Insulin',
    strength: '100IU/ml',
    price: 480_00,
    form: 'Injection',
    category: 'Diabetes',
    prescription: true,
    coldChain: true,
  },
  {
    sku: 'VAC-TT',
    brand: 'Tetavax',
    generic: 'Tetanus Toxoid',
    strength: '0.5ml',
    price: 220_00,
    form: 'Injection',
    category: 'Vaccines',
    prescription: true,
    coldChain: true,
  },

  // ── Everyday counter lines ────────────────────────────────────────────────
  {
    sku: 'ORS-20',
    brand: 'Orsaline-N',
    generic: 'Oral Rehydration Salts',
    strength: '20.5g',
    price: 8_00,
    form: 'Sachet',
    category: 'General',
  },
  {
    sku: 'ZIN-20',
    brand: 'Zinet',
    generic: 'Zinc Sulphate',
    strength: '20mg',
    price: 30_00,
    form: 'Syrup',
    category: 'Vitamins',
  },
  {
    sku: 'VIT-D',
    brand: 'D-Rise',
    generic: 'Cholecalciferol',
    strength: '40000IU',
    price: 65_00,
    category: 'Vitamins',
  },
  {
    sku: 'CAL-500',
    brand: 'Calbo-D',
    generic: 'Calcium + Vitamin D3',
    strength: '500mg',
    price: 95_00,
    category: 'Vitamins',
  },
  {
    sku: 'ANT-GEL',
    brand: 'Antacid Plus',
    generic: 'Aluminium Hydroxide',
    strength: '200mg/5ml',
    price: 55_00,
    form: 'Suspension',
    category: 'Stomach',
  },
  {
    sku: 'DOM-10',
    brand: 'Domin',
    generic: 'Domperidone',
    strength: '10mg',
    price: 42_00,
    category: 'Stomach',
  },
  {
    sku: 'SAL-INH',
    brand: 'Asthalin',
    generic: 'Salbutamol',
    strength: '100mcg',
    price: 310_00,
    form: 'Inhaler',
    category: 'Respiratory',
  },
  {
    sku: 'CET-10',
    brand: 'Alatrol',
    generic: 'Cetirizine',
    strength: '10mg',
    price: 25_00,
    category: 'Respiratory',
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

  /*
   * Six more, so a customer picker has to be searched rather than scrolled and
   * the ledger, ageing and collection screens have more than two rows to sort.
   * They belong to the two seeded owners because an owner is a user account and
   * adding more of those changes who the role tests are talking about — a shop
   * with several branches under one owner is also the ordinary case here.
   */
  {
    key: 'shop-d',
    name: 'Gulshan Pharma',
    ownerKey: 'owner3',
    status: ShopStatus.ACTIVE,
    creditLimit: 300_000_00,
    phone: '01711000004',
  },
  {
    key: 'shop-e',
    name: 'Dhanmondi Medicine Corner',
    ownerKey: 'owner4',
    status: ShopStatus.ACTIVE,
    creditLimit: 150_000_00,
    phone: '01711000005',
  },
  {
    key: 'shop-f',
    name: 'Banani Health Store',
    ownerKey: 'owner5',
    status: ShopStatus.ACTIVE,
    creditLimit: 120_000_00,
    phone: '01711000006',
  },
  {
    key: 'shop-g',
    name: 'Mohakhali Drug Mart',
    ownerKey: 'owner6',
    status: ShopStatus.ACTIVE,
    creditLimit: 80_000_00,
    phone: '01711000007',
  },
  {
    key: 'shop-h',
    name: 'Bashundhara City Pharmacy',
    ownerKey: 'owner7',
    status: ShopStatus.ACTIVE,
    creditLimit: 250_000_00,
    phone: '01711000008',
  },
  {
    key: 'shop-i',
    name: 'Savar Janata Medical Hall',
    ownerKey: 'owner8',
    status: ShopStatus.ACTIVE,
    creditLimit: 60_000_00,
    phone: '01711000009',
  },
];

/** Who this distributor buys from. Nothing anywhere created one before. */
const SUPPLIERS = [
  {
    key: 'beximco',
    name: 'Beximco Pharmaceuticals Ltd',
    contact: 'Kamrul Hasan',
    phone: '01811000001',
  },
  {
    key: 'square',
    name: 'Square Pharmaceuticals PLC',
    contact: 'Nasrin Sultana',
    phone: '01811000002',
  },
  {
    key: 'incepta',
    name: 'Incepta Pharmaceuticals Ltd',
    contact: 'Sabbir Rahman',
    phone: '01811000003',
  },
  { key: 'renata', name: 'Renata Limited', contact: 'Farida Yasmin', phone: '01811000004' },
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
        dosageForm: item.form ?? 'Tablet',
        packSize: item.form && item.form !== 'Tablet' ? '1' : '10',
        unit: item.form && item.form !== 'Tablet' ? item.form.toLowerCase() : 'box',
        category: item.category ?? 'General',
        barcode: `880${String(1000000 + index).padStart(10, '0')}`,
        costPriceMinor: Math.round(item.price * 0.7),
        // A round retail price above trade, so the margin the medicine page
        // computes is a real number rather than a blank.
        mrpMinor: Math.round((item.price * 1.25) / 100) * 100,
        defaultSellingPriceMinor: item.price,
        minimumOrderQuantity: 1,
        coldChain: item.coldChain ?? false,
        classification: item.prescription
          ? MedicineClassification.PRESCRIPTION
          : MedicineClassification.OTC,
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

/** Suppliers and one received purchase order, neither of which existed before. */
async function seedPurchasing() {
  process.stdout.write('Buying in\n');
  /*
   * Keyed on this seed's own records rather than on "are there any suppliers".
   *
   * The end-to-end database is not thrown away between runs, and
   * `pickers.spec.ts` creates a supplier every time it proves a purchase order
   * can be raised for one that did not exist yet. So "the table is not empty"
   * was true after the first browser run, and the seed then skipped its own
   * four suppliers and both purchase orders for good — which is how the
   * purchasing screens came to show nothing but a column of
   * *Padma Traders 1785988918156508*.
   */
  const supplierIds = new Map<string, string>();
  let madeSuppliers = 0;
  for (const supplier of SUPPLIERS) {
    const known = await Supplier.findOne({ name: supplier.name }).select('_id');
    if (known) {
      supplierIds.set(supplier.key, String(known._id));
      continue;
    }
    const created = await must<{ _id: string }>(
      `Supplier ${supplier.key}`,
      'POST',
      '/api/v1/purchasing/suppliers',
      {
        as: 'manager',
        body: {
          name: supplier.name,
          primaryPhone: supplier.phone,
          contactName: supplier.contact,
          paymentTermsDays: 45,
        },
      },
    );
    supplierIds.set(supplier.key, created._id);
    madeSuppliers += 1;
  }
  note(`${madeSuppliers} suppliers created, ${SUPPLIERS.length - madeSuppliers} already there`);

  if (!(await PurchaseOrder.exists({ supplierReference: 'BEX-PO-4471' }))) {
    /*
     * Two purchase orders: one still open, one received in full — so the goods
     * receipt screen has both a thing to do and a thing already done, and the
     * batches that arrive carry a different cost from the seeded ones, which is
     * what makes a stock valuation more than one number repeated.
     */
    const beximco = supplierIds.get('beximco')!;
    const square = supplierIds.get('square')!;
    const line = (sku: string, quantity: number, cost: number) => ({
      medicineId: String(fixedId(`medicine:${sku}`)),
      orderedQuantity: quantity,
      unitCostMinor: cost,
    });

    await must('Open purchase order', 'POST', '/api/v1/purchasing/orders', {
      as: 'manager',
      body: {
        supplierId: beximco,
        supplierReference: 'BEX-PO-4471',
        lines: [
          line('NAP-500', 2000, 8_40),
          line('ACE-100', 1500, 6_60),
          line('ORS-20', 3000, 5_20),
        ],
      },
    });

    const receivable = await must<{ _id: string; lines: Array<{ _id: string }> }>(
      'Received purchase order',
      'POST',
      '/api/v1/purchasing/orders',
      {
        as: 'manager',
        body: {
          supplierId: square,
          supplierReference: 'SQ-PO-8820',
          lines: [line('SEC-20', 800, 48_00), line('MET-500', 600, 38_00)],
        },
      },
    );

    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 20);
    await must('Goods receipt', 'POST', `/api/v1/purchasing/orders/${receivable._id}/receipts`, {
      as: 'storekeeper',
      body: {
        supplierInvoiceReference: 'SQ-INV-19003',
        lines: receivable.lines.map((entry, index) => ({
          purchaseOrderLineId: String(entry._id),
          receivedQuantity: index === 0 ? 800 : 600,
          batchNumber: `SQ-${index === 0 ? 'SEC' : 'MET'}-2601`,
          expiryDate: expiry.toISOString().slice(0, 10),
          manufacturingDate: new Date(expiry.getFullYear() - 2, expiry.getMonth(), 1)
            .toISOString()
            .slice(0, 10),
          unitCostMinor: index === 0 ? 48_00 : 38_00,
          warehouseLocation: index === 0 ? 'B1-1' : 'B1-2',
        })),
      },
    });
    note('2 purchase orders, one received in full');
  } else {
    note('purchase orders already there');
  }
}

interface FulfilledOrder {
  orderId: string;
  invoiceId?: string;
  invoiceTotalMinor?: number;
  deliveryId?: string;
}

/**
 * One order, all the way from a shop owner pressing Submit to an issued
 * invoice, through the endpoints a person uses.
 *
 * Nothing here writes a status. Every step is the request the screen makes,
 * signed in as the role the server requires, which is what stops the seed
 * drifting away from the product: if approval starts demanding a field, this
 * fails rather than producing an order no sequence of clicks could create.
 *
 * Each step checks the current state first, so a rerun resumes rather than
 * repeats — `submit` is idempotent by key, and the rest are guarded by the
 * status they would move away from.
 */
async function fulfilOrder(
  key: string,
  shopKey: string,
  ownerKey: string,
  lines: Array<{ sku: string; quantity: number }>,
): Promise<FulfilledOrder> {
  const shopId = fixedId(`shop:${shopKey}`);
  const shop = await Shop.findById(shopId).select('deliveryAddresses');
  const submitted = await must<{ _id: string }>(`Order ${key}`, 'POST', '/api/v1/orders/submit', {
    as: ownerKey,
    body: {
      items: lines.map((entry) => ({
        medicineId: String(fixedId(`medicine:${entry.sku}`)),
        requestedQuantity: entry.quantity,
      })),
      deliveryAddressId: String(shop!.deliveryAddresses[0]!._id),
      requestedPaymentMethod: PaymentMethod.CASH,
      idempotencyKey: `seed-order-${key}`,
    },
  });
  const orderId = submitted._id;

  const review = await orderForReview(orderId);
  if (review.status === 'SUBMITTED' || review.status === 'UNDER_REVIEW') {
    await must('Approve', 'POST', `/api/v1/approvals/${orderId}/approve`, {
      as: 'manager',
      body: {
        version: review.version,
        lines: review.items.map((item) => ({
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

  const queue = await must<
    Array<{ _id: string; version: number; status: string; orderId: { _id: string } | string }>
  >('Picking queue', 'GET', '/api/v1/fulfilment/queue', { as: 'storekeeper' });
  const list = queue.find((entry) => {
    const owner = typeof entry.orderId === 'string' ? entry.orderId : entry.orderId?._id;
    return String(owner) === orderId;
  });
  // Nothing to pick means the order never reached fulfilment, which is a
  // failure worth stopping on rather than a state to skip past.
  if (!list) throw new Error(`Order ${key} has no picking list; approval did not produce one.`);

  /*
   * `medicineId` comes back **populated** on this endpoint — the picker's
   * screen needs the brand name — while `batchId` deliberately does not,
   * because the client posts that one straight back. So the id has to be dug
   * out of the document rather than stringified, and getting that wrong fails
   * as `PICK_LIMIT`: the server matches no line, finds no confirmation for the
   * allocation, and reports it as picking too much.
   */
  interface PickingDetail {
    _id: string;
    version: number;
    status: string;
    items: Array<{ medicineId: string | { _id: string }; batchId: string; quantity: number }>;
  }
  const idOf = (value: string | { _id: string }) =>
    typeof value === 'string' ? value : String(value._id);

  let detail = await must<PickingDetail>(
    'Picking detail',
    'GET',
    `/api/v1/fulfilment/picking/${list._id}`,
    { as: 'storekeeper' },
  );

  if (detail.status === 'PENDING') {
    await must('Start picking', 'POST', `/api/v1/fulfilment/picking/${list._id}/start`, {
      as: 'storekeeper',
      body: { version: detail.version },
    });
    detail = await must<PickingDetail>(
      'Picking detail',
      'GET',
      `/api/v1/fulfilment/picking/${list._id}`,
      { as: 'storekeeper' },
    );
  }

  if (detail.status === 'PICKING') {
    await must('Complete picking', 'POST', `/api/v1/fulfilment/picking/${list._id}/progress`, {
      as: 'storekeeper',
      body: {
        version: detail.version,
        action: 'COMPLETE',
        items: detail.items.map((item) => ({
          medicineId: idOf(item.medicineId),
          batchId: String(item.batchId),
          pickedQuantity: item.quantity,
        })),
      },
    });
    detail = await must<PickingDetail>(
      'Picking detail',
      'GET',
      `/api/v1/fulfilment/picking/${list._id}`,
      { as: 'storekeeper' },
    );
  }

  if (detail.status === 'PACKING') {
    const packed = await must<{
      invoice?: { _id: string; grandTotalMinor: number };
    }>('Pack', 'POST', `/api/v1/fulfilment/picking/${list._id}/pack`, {
      as: 'storekeeper',
      body: {
        version: detail.version,
        items: detail.items.map((item) => ({
          medicineId: idOf(item.medicineId),
          batchId: String(item.batchId),
          packedQuantity: item.quantity,
        })),
        packageCount: 1,
        weightGrams: 900,
      },
    });
    return {
      orderId,
      invoiceId: packed.invoice?._id,
      invoiceTotalMinor: packed.invoice?.grandTotalMinor,
    };
  }

  /*
   * Already packed on an earlier run, so nothing above issued an invoice — but
   * one exists, and everything downstream (the dates, the payments, the
   * ageing) is keyed on it. Without this a second seed against the same
   * database reported "0 invoices" and quietly left the money side empty,
   * which is exactly the shape of failure the loud `must()` helper exists to
   * prevent and this silently walked past.
   */
  const issued = await Invoice.findOne({ orderId }).select('_id grandTotalMinor');
  return issued
    ? {
        orderId,
        invoiceId: String(issued._id),
        invoiceTotalMinor: (issued as { grandTotalMinor?: number }).grandTotalMinor,
      }
    : { orderId };
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

  await seedPurchasing();

  /*
   * A month of trading.
   *
   * Everything above parks one order at each state a screen exists for. That
   * is enough to prove a screen renders and nowhere near enough to *use* the
   * system: with no issued invoice there is no revenue, no receivable, nothing
   * to age, nothing to collect and nothing to chart — which is why the home
   * screen's sales line was flat and its "who owes us" card said nothing is
   * outstanding.
   *
   * Fourteen orders across seven shops, each driven the whole way to an issued
   * invoice through the real endpoints.
   */
  process.stdout.write('A month of trading\n');
  const TRADING: Array<{
    key: string;
    shop: string;
    owner: string;
    daysAgo: number;
    lines: Array<{ sku: string; quantity: number }>;
  }> = [
    {
      key: 't01',
      shop: 'shop-a',
      owner: 'owner',
      daysAgo: 34,
      lines: [
        { sku: 'NAP-500', quantity: 60 },
        { sku: 'ORS-20', quantity: 120 },
      ],
    },
    {
      key: 't02',
      shop: 'shop-d',
      owner: 'owner3',
      daysAgo: 31,
      lines: [
        { sku: 'AZI-500', quantity: 20 },
        { sku: 'CET-10', quantity: 40 },
      ],
    },
    {
      key: 't03',
      shop: 'shop-f',
      owner: 'owner5',
      daysAgo: 28,
      lines: [
        { sku: 'ATO-20', quantity: 30 },
        { sku: 'AML-5', quantity: 45 },
      ],
    },
    {
      key: 't04',
      shop: 'shop-b',
      owner: 'owner2',
      daysAgo: 25,
      lines: [
        { sku: 'SEC-20', quantity: 25 },
        { sku: 'DOM-10', quantity: 35 },
      ],
    },
    {
      key: 't05',
      shop: 'shop-h',
      owner: 'owner7',
      daysAgo: 22,
      lines: [
        { sku: 'INS-100', quantity: 12 },
        { sku: 'GLI-80', quantity: 30 },
      ],
    },
    {
      key: 't06',
      shop: 'shop-e',
      owner: 'owner4',
      daysAgo: 19,
      lines: [
        { sku: 'NAP-SYP', quantity: 50 },
        { sku: 'ZIN-20', quantity: 40 },
      ],
    },
    {
      key: 't07',
      shop: 'shop-g',
      owner: 'owner6',
      daysAgo: 16,
      lines: [
        { sku: 'CIP-500', quantity: 18 },
        { sku: 'FLU-150', quantity: 22 },
      ],
    },
    {
      key: 't08',
      shop: 'shop-a',
      owner: 'owner',
      daysAgo: 13,
      lines: [
        { sku: 'MON-10', quantity: 20 },
        { sku: 'SAL-INH', quantity: 10 },
      ],
    },
    {
      key: 't09',
      shop: 'shop-i',
      owner: 'owner8',
      daysAgo: 11,
      lines: [
        { sku: 'CAL-500', quantity: 30 },
        { sku: 'VIT-D', quantity: 25 },
      ],
    },
    {
      key: 't10',
      shop: 'shop-d',
      owner: 'owner3',
      daysAgo: 8,
      lines: [
        { sku: 'CEFT-1G', quantity: 15 },
        { sku: 'ETO-90', quantity: 20 },
      ],
    },
    {
      key: 't11',
      shop: 'shop-f',
      owner: 'owner5',
      daysAgo: 6,
      lines: [
        { sku: 'MET-500', quantity: 40 },
        { sku: 'ATE-50', quantity: 35 },
      ],
    },
    {
      key: 't12',
      shop: 'shop-h',
      owner: 'owner7',
      daysAgo: 4,
      lines: [
        { sku: 'AMO-500', quantity: 22 },
        { sku: 'NAP-EXT', quantity: 60 },
      ],
    },
    {
      key: 't13',
      shop: 'shop-e',
      owner: 'owner4',
      daysAgo: 2,
      lines: [
        { sku: 'CEF-SYP', quantity: 16 },
        { sku: 'ANT-GEL', quantity: 30 },
      ],
    },
    {
      key: 't14',
      shop: 'shop-b',
      owner: 'owner2',
      daysAgo: 1,
      lines: [
        { sku: 'DIC-50', quantity: 40 },
        { sku: 'ACE-PLUS', quantity: 50 },
      ],
    },
  ];

  const traded: Array<FulfilledOrder & { shop: string; daysAgo: number }> = [];
  for (const entry of TRADING) {
    const result = await fulfilOrder(entry.key, entry.shop, entry.owner, entry.lines);
    traded.push({ ...result, shop: entry.shop, daysAgo: entry.daysAgo });
  }

  /*
   * The one thing here that is not done through the API: moving the clock.
   *
   * An invoice is issued when it is packed, and the packing endpoint quite
   * rightly has no "pretend this happened last month" parameter. So the
   * transitions above are all real and only the two dates are rewritten
   * afterwards — which is what turns fourteen invoices dated today into a month
   * of trade with an ageing profile. Payments need no such help: `collectedAt`
   * is part of the request a person makes.
   */
  const invoiced = traded.filter((entry) => entry.invoiceId);
  for (const entry of invoiced) {
    const issued = new Date();
    issued.setDate(issued.getDate() - entry.daysAgo);
    const due = new Date(issued);
    due.setDate(due.getDate() + 30);
    await Invoice.updateOne(
      { _id: entry.invoiceId },
      { $set: { invoiceDate: issued, dueDate: due } },
    );
  }
  note(`${invoiced.length} invoices, dated across the last five weeks`);

  /*
   * Who has paid, and who has not.
   *
   * Deliberately uneven, because an ageing report where everything is either
   * settled or outstanding tells you nothing: the oldest are paid in full, the
   * middle are part-paid, and the newest are untouched. The two oldest are left
   * unpaid on purpose so the overdue bucket and the credit block have a real
   * example to show.
   */
  process.stdout.write('Money in\n');
  let payments = 0;
  for (const [index, entry] of invoiced.entries()) {
    if (!entry.invoiceTotalMinor) continue;
    const overdue = entry.daysAgo > 30;
    const share = overdue ? 0 : index % 3 === 0 ? 1 : index % 3 === 1 ? 0.6 : 0;
    if (share === 0) continue;

    const collected = new Date();
    collected.setDate(collected.getDate() - Math.max(0, entry.daysAgo - 5));
    await must('Payment', 'POST', '/api/v1/payments', {
      as: 'manager',
      body: {
        shopId: String(fixedId(`shop:${entry.shop}`)),
        invoiceId: entry.invoiceId,
        amountMinor: Math.round(entry.invoiceTotalMinor * share),
        method: PaymentMethod.CASH,
        collectedAt: collected.toISOString(),
        postNow: true,
        idempotencyKey: `seed-payment-${entry.orderId}`,
      },
    });
    payments += 1;
  }
  note(`${payments} payments posted, two invoices left overdue on purpose`);

  /*
   * On the road.
   *
   * Packing creates the delivery; nothing had ever moved one, so the deliveries
   * board, the rider's screens and the home screen's "out for delivery" tile
   * were all permanently empty. Six of the fourteen are pushed along, three of
   * them the whole way to the rider having set off.
   *
   * Deliberately stopping short of `complete`: completion demands the proofs
   * `DELIVERY_REQUIRED_PROOFS` asks for, which is an OTP sent to the shop owner
   * and read back. Faking that would mean writing a code the system believes it
   * generated, and a seed that forges a proof of delivery is exactly the kind of
   * record the audit rules exist to prevent.
   */
  process.stdout.write('On the road\n');
  const riderId = String(fixedId('user:rider'));
  let assigned = 0;
  let travelling = 0;

  for (const [index, entry] of traded.slice(0, 6).entries()) {
    const delivery = await call<{
      items?: Array<{ _id: string; version: number; status: string }>;
    }>('GET', `/api/v1/deliveries?orderId=${entry.orderId}`, { as: 'manager' });
    const list = Array.isArray(delivery.data)
      ? (delivery.data as Array<{ _id: string; version: number; status: string }>)
      : (delivery.data?.items ?? []);
    const found = list.find(Boolean);
    if (!found) continue;

    interface DeliveryNow {
      version: number;
      status: string;
      packageId?: { reference?: string; packageCount?: number };
      invoiceId?: { reference?: string } | string;
    }
    const read = (as: string) =>
      must<DeliveryNow>('Delivery', 'GET', `/api/v1/deliveries/${found._id}`, { as });

    const step = async (path: string, as: string, body: Record<string, unknown> = {}) => {
      const current = await read(as);
      await must(`Delivery ${path}`, 'POST', `/api/v1/deliveries/${found._id}/${path}`, {
        as,
        body: { version: current.version, idempotencyKey: `seed-${path}-${found._id}`, ...body },
      });
    };

    const expected = new Date();
    expected.setDate(expected.getDate() + 1);

    if (found.status === 'READY_FOR_ASSIGNMENT') {
      await step('assign', 'manager', {
        deliveryPersonId: riderId,
        expectedDeliveryDate: expected.toISOString().slice(0, 10),
        priority: index % 3 === 0 ? DeliveryPriority.HIGH : DeliveryPriority.NORMAL,
      });
      assigned += 1;
    }

    // The first three carry on until the rider has left the building.
    if (index < 3) {
      /*
       * The handover is a *check*, not a declaration: the storekeeper reads the
       * references off the package in their hands and the server refuses if
       * they do not match what it issued. So they are read back from the
       * delivery rather than invented — inventing them is `HANDOVER_MISMATCH`,
       * which is the endpoint doing its job.
       */
      const current = await read('storekeeper');
      const invoice = await Invoice.findById(entry.invoiceId).select('reference');
      await step('handover', 'storekeeper', {
        packageReference: current.packageId?.reference,
        invoiceReference:
          typeof current.invoiceId === 'object'
            ? current.invoiceId?.reference
            : (invoice?.reference ?? undefined),
        packageCount: current.packageId?.packageCount ?? 1,
      });
      await step('acknowledge', 'rider');
      await step('pickup', 'rider');
      await step('start', 'rider');
      travelling += 1;
    }
  }
  note(`${assigned} deliveries assigned, ${travelling} out on the road`);

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
