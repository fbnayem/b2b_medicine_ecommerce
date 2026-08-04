import { Types } from 'mongoose';
import { Delivery } from '../models/Delivery';
import { GoodsReceipt } from '../models/GoodsReceipt';
import { Invoice } from '../models/Invoice';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { Shop } from '../models/Shop';
import { Supplier } from '../models/Supplier';

/**
 * Given a batch: who has it, and where did it come from.
 *
 * This is the question a recall is. Every fact it needs was already recorded —
 * invoice lines carry `batchId`, deliveries carry their invoice — and **no code
 * anywhere asked it**, so answering it meant somebody exporting invoices and
 * reading them. `items.batchId` was not even indexed, so the query would have
 * been a full collection scan on the day it was most urgently needed.
 *
 * Deliberately read-only and side-effect free. Initiating a recall is a
 * decision with consequences for customers and for the regulator; looking one
 * up must never be, so that anybody can check a batch without committing to
 * anything.
 */

export interface RecallRecipient {
  shopId: string;
  shopReference: string;
  shopName: string;
  primaryPhone: string;
  invoiceId: string;
  invoiceReference: string;
  invoiceDate: Date;
  quantity: number;
  /** When it physically arrived, when a delivery recorded it. */
  deliveredAt?: Date;
  deliveryReference?: string;
  receiverName?: string;
}

export interface RecallOrigin {
  supplierId?: string;
  supplierName?: string;
  supplierReference?: string;
  supplierPhone?: string;
  drugLicenceNumber?: string;
  purchaseOrderReference?: string;
  goodsReceiptReference?: string;
  supplierInvoiceReference?: string;
  supplierBatchReference?: string;
  receivedAt?: Date;
  /**
   * True when the batch predates purchasing.
   *
   * Said plainly rather than left as an absent supplier, because "we do not
   * know" and "this arrived before we recorded suppliers" are different answers
   * to an inspector, and only one of them is defensible.
   */
  predatesPurchasing: boolean;
}

export interface RecallTrace {
  batch: {
    id: string;
    batchNumber: string;
    expiryDate: Date;
    manufacturingDate: Date;
    receivedQuantity: number;
    remainingOnHand: number;
    isBlocked: boolean;
    isQuarantined: boolean;
  };
  medicine: {
    id: string;
    reference: string;
    brandName: string;
    genericName: string;
    strength: string;
    manufacturer: string;
  };
  /** Forward: everyone who received any of it. */
  recipients: RecallRecipient[];
  /** Backward: where it came from. */
  origin: RecallOrigin;
  totals: {
    shopsAffected: number;
    quantityDespatched: number;
    quantityStillHeld: number;
    /** Received, minus what went out, minus what is still on the shelf. */
    quantityUnaccounted: number;
  };
}

function traceError(message: string, code: string, statusCode = 404) {
  return Object.assign(new Error(message), { statusCode, code });
}

export async function traceBatch(batchId: string): Promise<RecallTrace> {
  if (!Types.ObjectId.isValid(batchId)) {
    throw traceError('That is not a batch identifier', 'INVALID_BATCH', 400);
  }

  const batch = await MedicineBatch.findById(batchId);
  if (!batch) throw traceError('Batch not found', 'NOT_FOUND');

  const medicine = await Medicine.findById(batch.medicineId);
  if (!medicine) throw traceError('The medicine for this batch is missing', 'NOT_FOUND');

  // The forward leg. Served by the `items.batchId` index added alongside this.
  const invoices = await Invoice.find({ 'items.batchId': batch._id })
    .select('reference invoiceDate shopId items')
    .sort({ invoiceDate: 1 })
    .lean();

  const shopIds = [...new Set(invoices.map((invoice) => String(invoice.shopId)))];
  const invoiceIds = invoices.map((invoice) => invoice._id);

  const [shops, deliveries] = await Promise.all([
    Shop.find({ _id: { $in: shopIds } })
      .select('reference name primaryPhone')
      .lean(),
    Delivery.find({ invoiceId: { $in: invoiceIds } })
      .select('reference invoiceId deliveredAt completion status')
      .lean(),
  ]);

  const shopById = new Map(shops.map((shop) => [String(shop._id), shop]));
  const deliveryByInvoice = new Map(
    deliveries.map((delivery) => [String(delivery.invoiceId), delivery]),
  );

  const recipients: RecallRecipient[] = [];
  for (const invoice of invoices) {
    // An invoice can list the same batch on more than one line — a split
    // allocation — and every unit of it is recalled, so they are summed rather
    // than the first one taken.
    const quantity = invoice.items
      .filter((item) => String(item.batchId) === String(batch._id))
      .reduce((sum, item) => sum + (item.quantity ?? 0), 0);
    if (quantity <= 0) continue;

    const shop = shopById.get(String(invoice.shopId));
    const delivery = deliveryByInvoice.get(String(invoice._id)) as
      | { reference?: string; deliveredAt?: Date; completion?: { receiverName?: string } }
      | undefined;

    recipients.push({
      shopId: String(invoice.shopId),
      shopReference: shop?.reference ?? '—',
      shopName: shop?.name ?? 'Unknown shop',
      // The number somebody rings when the recall is real.
      primaryPhone: shop?.primaryPhone ?? '',
      invoiceId: String(invoice._id),
      invoiceReference: invoice.reference,
      invoiceDate: invoice.invoiceDate,
      quantity,
      deliveredAt: delivery?.deliveredAt,
      deliveryReference: delivery?.reference,
      receiverName: delivery?.completion?.receiverName,
    });
  }

  // The backward leg.
  const [supplier, purchaseOrder, goodsReceipt] = await Promise.all([
    batch.supplierId ? Supplier.findById(batch.supplierId).lean() : null,
    batch.purchaseOrderId
      ? PurchaseOrder.findById(batch.purchaseOrderId).select('reference').lean()
      : null,
    batch.goodsReceiptId
      ? GoodsReceipt.findById(batch.goodsReceiptId).select('reference receivedAt').lean()
      : null,
  ]);

  const quantityDespatched = recipients.reduce((sum, entry) => sum + entry.quantity, 0);
  const remainingOnHand = batch.quantities.onHand;

  return {
    batch: {
      id: String(batch._id),
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      manufacturingDate: batch.manufacturingDate,
      receivedQuantity: batch.receivedQuantity,
      remainingOnHand,
      isBlocked: batch.isBlocked,
      isQuarantined: batch.isQuarantined,
    },
    medicine: {
      id: String(medicine._id),
      reference: medicine.reference,
      brandName: medicine.brandName,
      /*
       * A recall trace is read under time pressure, and an empty cell is a
       * clearer answer than a missing key. Both are now optional on the
       * catalogue — a shampoo has no generic name — and while a recalled batch
       * is almost always a drug, the trace must render whatever it is handed
       * rather than fail on a shelf line somebody stocked.
       */
      genericName: medicine.genericName ?? '',
      strength: medicine.strength ?? '',
      manufacturer: medicine.manufacturer,
    },
    recipients,
    origin: {
      supplierId: supplier ? String(supplier._id) : undefined,
      supplierName: supplier?.name,
      supplierReference: supplier?.reference,
      supplierPhone: supplier?.primaryPhone,
      drugLicenceNumber: supplier?.drugLicenceNumber ?? undefined,
      purchaseOrderReference: purchaseOrder?.reference,
      goodsReceiptReference: goodsReceipt?.reference,
      supplierInvoiceReference: batch.supplierInvoiceReference ?? undefined,
      supplierBatchReference: batch.supplierBatchReference ?? undefined,
      receivedAt: goodsReceipt?.receivedAt ?? batch.createdAt,
      predatesPurchasing: !batch.supplierId,
    },
    totals: {
      shopsAffected: new Set(recipients.map((entry) => entry.shopId)).size,
      quantityDespatched,
      quantityStillHeld: remainingOnHand,
      /*
       * What the arithmetic cannot account for: damaged, expired, written off,
       * or returned. Surfaced rather than hidden, because a recall that says
       * "we sent 400 and can find 380" is asking a question somebody must
       * answer before the recall is closed.
       */
      quantityUnaccounted: Math.max(
        0,
        batch.receivedQuantity - quantityDespatched - remainingOnHand,
      ),
    },
  };
}

/**
 * Finds a batch by the number printed on the carton.
 *
 * Whoever raises a recall is holding a supplier's notice with a batch number on
 * it, not a database identifier — and the same number can legitimately appear
 * against two different medicines, so this returns every match rather than
 * guessing.
 */
export async function findBatchesByNumber(batchNumber: string) {
  const normalised = batchNumber.trim().toUpperCase();
  if (!normalised) throw traceError('Enter a batch number', 'INVALID_BATCH', 400);

  const batches = await MedicineBatch.find({ batchNumber: normalised })
    .select('batchNumber medicineId expiryDate quantities')
    .populate('medicineId', 'reference brandName genericName strength manufacturer')
    .lean();

  return batches;
}
