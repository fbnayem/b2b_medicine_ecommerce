import mongoose, { Types } from 'mongoose';
import { StockMovementType, UserRole } from '@medsupply/shared-types';
import { AuditLog } from '../models/AuditLog';
import { GoodsReceipt } from '../models/GoodsReceipt';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { PurchaseOrder, PurchaseOrderStatus } from '../models/PurchaseOrder';
import { StockMovement } from '../models/StockMovement';
import { Supplier } from '../models/Supplier';
import { nextReference } from '../models/Counter';

/**
 * Buying stock, and booking it in against what was bought.
 *
 * `receiveStock` created inventory from nothing — a batch number, an expiry and
 * a quantity — so the system could say where a batch went and never where it
 * came from. For a DGDA-inspected distributor that is the half an inspector
 * asks for first.
 *
 * The old endpoint still exists and still works, because stock does arrive
 * without a purchase order — a sample, a replacement for a damaged carton, an
 * opening balance. What has changed is that stock arriving *against an order*
 * now carries its provenance, and the ordered-versus-received difference is
 * recorded rather than silently accepted.
 */

export interface PurchasingActor {
  _id: Types.ObjectId;
  role: UserRole;
}

/** Who may commit the business to buying something. */
export const PURCHASING_ROLES: readonly UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
];

/** Who may book goods in. The storekeeper counts the cartons, so the storekeeper receives. */
export const RECEIVING_ROLES: readonly UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.STOREKEEPER,
];

function purchasingError(message: string, code: string, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode, code });
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  lines: Array<{ medicineId: string; orderedQuantity: number; unitCostMinor: number }>;
  expectedDate?: Date;
  supplierReference?: string;
  notes?: string;
}

export async function createPurchaseOrder(input: CreatePurchaseOrderInput, actor: PurchasingActor) {
  if (!PURCHASING_ROLES.includes(actor.role)) {
    throw purchasingError(
      'Only a manager or administrator can raise a purchase order',
      'FORBIDDEN',
      403,
    );
  }
  if (input.lines.length === 0) {
    throw purchasingError('A purchase order needs at least one line', 'EMPTY_ORDER', 400);
  }

  const supplier = await Supplier.findById(input.supplierId);
  if (!supplier || !supplier.isActive) {
    throw purchasingError('Supplier not found or no longer active', 'SUPPLIER_UNAVAILABLE', 404);
  }

  const medicineIds = input.lines.map((line) => line.medicineId);
  if (new Set(medicineIds).size !== medicineIds.length) {
    throw purchasingError('A medicine may appear only once on an order', 'DUPLICATE_LINE', 400);
  }

  const medicines = await Medicine.find({ _id: { $in: medicineIds } });
  if (medicines.length !== medicineIds.length) {
    throw purchasingError('One or more medicines could not be found', 'MEDICINE_UNAVAILABLE', 400);
  }
  const byId = new Map(medicines.map((medicine) => [String(medicine._id), medicine]));

  const order = await PurchaseOrder.create({
    reference: await nextReference('PO'),
    supplierId: supplier._id,
    status: PurchaseOrderStatus.ISSUED,
    issuedAt: new Date(),
    issuedBy: actor._id,
    expectedDate: input.expectedDate,
    supplierReference: input.supplierReference,
    notes: input.notes,
    createdBy: actor._id,
    lines: input.lines.map((line) => {
      const medicine = byId.get(line.medicineId)!;
      return {
        medicineId: medicine._id,
        // Snapshotted, because a medicine renamed a year later must not rewrite
        // what was ordered.
        medicineSnapshot: {
          reference: medicine.reference,
          sku: medicine.sku,
          brandName: medicine.brandName,
          genericName: medicine.genericName,
          strength: medicine.strength,
        },
        orderedQuantity: line.orderedQuantity,
        receivedQuantity: 0,
        unitCostMinor: line.unitCostMinor,
      };
    }),
  });

  await AuditLog.create({
    actorId: actor._id,
    actorRole: actor.role,
    action: 'PURCHASE_ORDER_ISSUED',
    entityType: 'PurchaseOrder',
    entityId: order._id,
    after: { reference: order.reference, supplier: supplier.name, lines: order.lines.length },
  });

  return order;
}

export interface ReceiveGoodsInput {
  purchaseOrderId: string;
  supplierInvoiceReference?: string;
  receivedAt?: Date;
  notes?: string;
  lines: Array<{
    purchaseOrderLineId: string;
    batchNumber: string;
    manufacturingDate: Date;
    expiryDate: Date;
    receivedQuantity: number;
    /** Falls back to the ordered cost, which is the usual case. */
    unitCostMinor?: number;
    warehouseLocation: string;
    supplierBatchReference?: string;
    varianceReason?: string;
  }>;
}

/**
 * Books a delivery in, creating one batch per line.
 *
 * Everything happens in one transaction: the batches, their stock movements,
 * the receipt, and the purchase order's running totals. A receipt that recorded
 * the paperwork but not the stock, or the reverse, would be worse than none —
 * the discrepancy would sit there looking like a counting error.
 */
export async function receiveGoods(input: ReceiveGoodsInput, actor: PurchasingActor) {
  if (!RECEIVING_ROLES.includes(actor.role)) {
    throw purchasingError('Only warehouse or management staff can receive goods', 'FORBIDDEN', 403);
  }
  if (input.lines.length === 0) {
    throw purchasingError('A receipt needs at least one line', 'EMPTY_RECEIPT', 400);
  }

  const session = await mongoose.startSession();
  try {
    let receipt: InstanceType<typeof GoodsReceipt> | undefined;

    await session.withTransaction(async () => {
      const order = await PurchaseOrder.findById(input.purchaseOrderId).session(session);
      if (!order) throw purchasingError('Purchase order not found', 'NOT_FOUND', 404);
      if (order.status === PurchaseOrderStatus.CANCELLED) {
        throw purchasingError('That purchase order was cancelled', 'ORDER_CANCELLED');
      }
      if (order.status === PurchaseOrderStatus.DRAFT) {
        throw purchasingError(
          'Issue the purchase order before receiving against it',
          'ORDER_NOT_ISSUED',
        );
      }

      const receiptLines = [];

      for (const line of input.lines) {
        const orderLine = order.lines.id(line.purchaseOrderLineId);
        if (!orderLine) {
          throw purchasingError('That line is not on this purchase order', 'INVALID_LINE', 400);
        }
        if (line.expiryDate <= line.manufacturingDate) {
          throw purchasingError('Expiry must be after manufacture', 'INVALID_DATES', 400);
        }
        if (line.expiryDate <= new Date()) {
          // Refused rather than quarantined: booking expired stock in creates
          // sellable-looking inventory that FEFO must then be trusted to skip.
          throw purchasingError(
            `Batch ${line.batchNumber} has already expired and cannot be received`,
            'EXPIRED_ON_ARRIVAL',
            400,
          );
        }

        const outstanding = orderLine.orderedQuantity - orderLine.receivedQuantity;
        if (line.receivedQuantity > outstanding) {
          throw purchasingError(
            `More of ${orderLine.medicineSnapshot?.brandName ?? 'this medicine'} arrived than was ` +
              `ordered: ${line.receivedQuantity} against ${outstanding} outstanding. Raise a ` +
              `separate order for the extra rather than booking it in here.`,
            'OVER_RECEIPT',
          );
        }

        const quantities = {
          onHand: line.receivedQuantity,
          available: line.receivedQuantity,
          reserved: 0,
          picking: 0,
          packed: 0,
          damaged: 0,
          expired: 0,
          returned: 0,
          quarantined: 0,
        };

        const [batch] = await MedicineBatch.create(
          [
            {
              medicineId: orderLine.medicineId,
              batchNumber: line.batchNumber,
              manufacturingDate: line.manufacturingDate,
              expiryDate: line.expiryDate,
              costPriceMinor: line.unitCostMinor ?? orderLine.unitCostMinor,
              receivedQuantity: line.receivedQuantity,
              quantities,
              warehouseLocation: line.warehouseLocation,
              // The provenance that makes a backward trace possible.
              supplierId: order.supplierId,
              purchaseOrderId: order._id,
              supplierBatchReference: line.supplierBatchReference,
              supplierInvoiceReference: input.supplierInvoiceReference,
              createdBy: actor._id,
            },
          ],
          { session },
        );

        await StockMovement.create(
          [
            {
              medicineId: orderLine.medicineId,
              batchId: batch._id,
              type: StockMovementType.RECEIPT,
              quantity: line.receivedQuantity,
              before: { ...quantities, onHand: 0, available: 0 },
              after: quantities,
              reason: `Received against ${order.reference}`,
              referenceType: 'PurchaseOrder',
              referenceId: String(order._id),
              actorId: actor._id,
              actorRole: actor.role,
              idempotencyKey: `goods-receipt:${order._id}:${batch._id}`,
            },
          ],
          { session },
        );

        const variance =
          orderLine.orderedQuantity - orderLine.receivedQuantity - line.receivedQuantity;
        receiptLines.push({
          purchaseOrderLineId: orderLine._id,
          medicineId: orderLine.medicineId,
          batchId: batch._id,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          orderedQuantity: orderLine.orderedQuantity,
          receivedQuantity: line.receivedQuantity,
          varianceQuantity: variance,
          varianceReason: line.varianceReason,
          unitCostMinor: line.unitCostMinor ?? orderLine.unitCostMinor,
        });

        orderLine.receivedQuantity += line.receivedQuantity;
      }

      const [created] = await GoodsReceipt.create(
        [
          {
            reference: await nextReference('GRN'),
            purchaseOrderId: order._id,
            supplierId: order.supplierId,
            supplierInvoiceReference: input.supplierInvoiceReference,
            receivedAt: input.receivedAt ?? new Date(),
            lines: receiptLines,
            notes: input.notes,
            receivedBy: actor._id,
          },
        ],
        { session },
      );

      // Each batch carries the receipt that created it, which is the link a
      // backward trace follows.
      await MedicineBatch.updateMany(
        { _id: { $in: receiptLines.map((line) => line.batchId) } },
        { $set: { goodsReceiptId: created._id } },
        { session },
      );

      const complete = order.lines.every((line) => line.receivedQuantity >= line.orderedQuantity);
      order.status = complete
        ? PurchaseOrderStatus.RECEIVED
        : PurchaseOrderStatus.PARTIALLY_RECEIVED;
      order.version += 1;
      await order.save({ session });

      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: 'GOODS_RECEIVED',
            entityType: 'GoodsReceipt',
            entityId: created._id,
            after: {
              reference: created.reference,
              purchaseOrder: order.reference,
              lines: receiptLines.length,
              shortfall: receiptLines.reduce(
                (sum, line) => sum + Math.max(0, line.varianceQuantity),
                0,
              ),
            },
          },
        ],
        { session },
      );

      receipt = created;
    });

    return receipt!;
  } finally {
    await session.endSession();
  }
}
