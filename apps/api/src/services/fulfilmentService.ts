import mongoose, { Types } from 'mongoose';
import {
  ActivityEntityType,
  NotificationCategory,
  NotificationEvent,
  OrderStatus,
  PaymentMethod,
  StockMovementType,
  UserRole,
} from '@medsupply/shared-types';
import { PickingList } from '../models/PickingList';
import { MedicineBatch } from '../models/MedicineBatch';
import { StockMovement } from '../models/StockMovement';
import { Order } from '../models/Order';
import { OrderApproval } from '../models/OrderApproval';
import { Invoice } from '../models/Invoice';
import { Package } from '../models/Package';
import { Shop } from '../models/Shop';
import { nextReference } from '../models/Counter';
import { calculatePackedInvoice, prorateMinor } from './invoiceMath';
import { AuditLog } from '../models/AuditLog';
import { Delivery } from '../models/Delivery';
import { configuredProofRequirements } from './deliveryService';
import { getLedgerBalance, postInvoiceCharge } from './ledgerService';
import { consumeCredit } from './creditReservationService';
import { CreditReservation } from '../models/CreditReservation';
import { assertSafeMoney, safeAdd } from './financialMath';
import { notify } from './notificationService';
import { ActivityVisibility, recordActivity } from './activityService';
import { userIdsWithRoles } from './notificationAudience';
import { getSettings } from './settingsService';
import { currencySnapshot } from './localisation';
type Actor = { _id: Types.ObjectId; role: UserRole };
export async function startPicking(id: string, version: number, actor: Actor) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const list = await PickingList.findOne({ _id: id, status: 'PENDING', version }).session(
        session,
      );
      if (!list)
        throw Object.assign(new Error('Picking list changed or is not pending'), {
          statusCode: 409,
          code: 'STALE_PICKING',
        });
      const order = await Order.findOne({
        _id: list.orderId,
        status: { $in: [OrderStatus.APPROVED, OrderStatus.PARTIALLY_APPROVED] },
      }).session(session);
      if (!order) {
        throw Object.assign(new Error('Order is no longer ready for picking'), {
          statusCode: 409,
          code: 'ORDER_NOT_READY',
        });
      }
      for (const item of list.items) {
        const before = await MedicineBatch.findOne({
          _id: item.batchId,
          'quantities.reserved': { $gte: item.quantity! },
          isBlocked: false,
          expiryDate: { $gt: new Date() },
        }).session(session);
        if (!before)
          throw Object.assign(new Error('Allocated batch is unavailable'), {
            statusCode: 409,
            code: 'INVALID_BATCH',
          });
        const updated = await MedicineBatch.findOneAndUpdate(
          {
            _id: before._id,
            version: before.version,
            'quantities.reserved': { $gte: item.quantity! },
          },
          {
            $inc: {
              'quantities.reserved': -item.quantity!,
              'quantities.picking': item.quantity!,
              version: 1,
            },
          },
          { new: true, session },
        );
        if (!updated)
          throw Object.assign(new Error('Concurrent picking conflict'), {
            statusCode: 409,
            code: 'CONCURRENT_PICKING',
          });
        await StockMovement.create(
          [
            {
              medicineId: item.medicineId!,
              batchId: item.batchId!,
              type: StockMovementType.PICKING,
              quantity: item.quantity!,
              before: before.quantities,
              after: updated.quantities,
              reason: 'Picking started',
              referenceType: 'PickingList',
              referenceId: String(list._id),
              actorId: actor._id,
              actorRole: actor.role,
              idempotencyKey: `picking:${list._id}:${item.batchId}`,
            },
          ],
          { session },
        );
        item.pickedQuantity = 0;
      }
      list.status = 'PICKING';
      list.startedBy = actor._id;
      list.startedAt = new Date();
      list.version += 1;
      await list.save({ session });
      const approvedStatus = order.status;
      order.status = OrderStatus.PREPARING;
      order.version += 1;
      order.statusHistory.push({
        from: approvedStatus,
        to: OrderStatus.PREPARING,
        actorId: actor._id,
        at: new Date(),
      });
      await order.save({ session });
      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: 'PICKING_STARTED',
            entityType: 'PickingList',
            entityId: list._id,
            after: list.toObject(),
          },
        ],
        { session },
      );
      result = list;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function recordPickingProgress(
  id: string,
  input: {
    version: number;
    action: 'SAVE' | 'PAUSE' | 'COMPLETE';
    items: Array<{ medicineId: string; batchId: string; pickedQuantity: number }>;
  },
  actor: Actor,
) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const list = await PickingList.findOne({
        _id: id,
        status: 'PICKING',
        version: input.version,
      }).session(session);
      if (!list) {
        throw Object.assign(new Error('Picking list changed or is not active'), {
          statusCode: 409,
          code: 'STALE_PICKING',
        });
      }
      const uniqueKeys = new Set(input.items.map((item) => `${item.medicineId}:${item.batchId}`));
      if (uniqueKeys.size !== list.items.length || input.items.length !== list.items.length) {
        throw Object.assign(new Error('Every allocated batch must be confirmed exactly once'), {
          statusCode: 400,
          code: 'PICKING_LINES',
        });
      }
      for (const item of list.items) {
        const confirmation = input.items.find(
          (value) =>
            value.medicineId === String(item.medicineId) && value.batchId === String(item.batchId),
        );
        if (!confirmation || confirmation.pickedQuantity > item.quantity!) {
          throw Object.assign(new Error('Picked quantity exceeds the allocated batch quantity'), {
            statusCode: 400,
            code: 'PICK_LIMIT',
          });
        }
        const validBatch = await MedicineBatch.exists({
          _id: item.batchId,
          medicineId: item.medicineId,
          isBlocked: false,
          expiryDate: { $gt: new Date() },
          'quantities.picking': { $gte: item.quantity! },
        }).session(session);
        if (!validBatch) {
          throw Object.assign(new Error('Confirmed batch is blocked, expired, or unavailable'), {
            statusCode: 409,
            code: 'INVALID_BATCH',
          });
        }
        item.pickedQuantity = confirmation.pickedQuantity;
      }
      const previousStatus = list.status;
      list.status =
        input.action === 'PAUSE' ? 'PAUSED' : input.action === 'COMPLETE' ? 'PACKING' : 'PICKING';
      list.version += 1;
      await list.save({ session });
      if (input.action === 'COMPLETE') {
        await Order.findOneAndUpdate(
          { _id: list.orderId, status: OrderStatus.PREPARING },
          {
            $set: { status: OrderStatus.PACKING },
            $inc: { version: 1 },
            $push: {
              statusHistory: {
                from: OrderStatus.PREPARING,
                to: OrderStatus.PACKING,
                actorId: actor._id,
                at: new Date(),
              },
            },
          },
          { session },
        );
      }
      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: `PICKING_${input.action}`,
            entityType: 'PickingList',
            entityId: list._id,
            before: { status: previousStatus },
            after: { status: list.status, items: list.items },
          },
        ],
        { session },
      );
      result = list;
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function resumePicking(id: string, version: number, actor: Actor) {
  const list = await PickingList.findOneAndUpdate(
    { _id: id, status: 'PAUSED', version },
    { $set: { status: 'PICKING' }, $inc: { version: 1 } },
    { new: true },
  );
  if (!list) {
    throw Object.assign(new Error('Picking list changed or is not paused'), {
      statusCode: 409,
      code: 'STALE_PICKING',
    });
  }
  await AuditLog.create({
    actorId: actor._id,
    actorRole: actor.role,
    action: 'PICKING_RESUMED',
    entityType: 'PickingList',
    entityId: list._id,
    after: { status: list.status },
  });
  return list;
}

export async function packAndInvoice(
  id: string,
  input: {
    version: number;
    items: Array<{
      medicineId: string;
      batchId: string;
      packedQuantity: number;
      shortfallReason?: string;
    }>;
    packageCount: number;
    weightGrams?: number;
    notes?: string;
  },
  actor: Actor,
) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const list = await PickingList.findOne({
        _id: id,
        status: 'PACKING',
        version: input.version,
      }).session(session);
      if (!list)
        throw Object.assign(new Error('Picking list changed or is not active'), {
          statusCode: 409,
          code: 'STALE_PICKING',
        });
      const order = await Order.findById(list.orderId).session(session);
      const approval = await OrderApproval.findById(list.approvalId).session(session);
      const shop = order && (await Shop.findById(order.shopId).session(session));
      if (!order || !approval || !shop) throw new Error('Fulfilment records are incomplete');
      const invoiceItems = [];
      const priceLines = [];
      const uniqueKeys = new Set(input.items.map((item) => `${item.medicineId}:${item.batchId}`));
      if (uniqueKeys.size !== list.items.length || input.items.length !== list.items.length) {
        throw Object.assign(new Error('Every picked batch must be packed exactly once'), {
          statusCode: 400,
          code: 'PACKING_LINES',
        });
      }
      if (input.items.every((item) => item.packedQuantity === 0)) {
        throw Object.assign(new Error('At least one item must be packed'), {
          statusCode: 400,
          code: 'EMPTY_PACKAGE',
        });
      }
      for (const packed of input.items) {
        const item = list.items.find(
          (value) =>
            String(value.medicineId) === packed.medicineId &&
            String(value.batchId) === packed.batchId,
        );
        if (!item || packed.packedQuantity > item.pickedQuantity)
          throw Object.assign(new Error('Packed quantity exceeds picked quantity'), {
            statusCode: 400,
            code: 'PACK_LIMIT',
          });
        if (packed.packedQuantity < item.pickedQuantity && !packed.shortfallReason)
          throw Object.assign(new Error('Shortfall reason is required'), {
            statusCode: 400,
            code: 'SHORTFALL_REASON',
          });
        const batch = await MedicineBatch.findOne({
          _id: item.batchId,
          isBlocked: false,
          expiryDate: { $gt: new Date() },
        }).session(session);
        if (!batch)
          throw Object.assign(new Error('Cannot pack blocked or expired batch'), {
            statusCode: 409,
            code: 'INVALID_BATCH',
          });
        const unused = item.quantity! - packed.packedQuantity;
        let current = batch;
        if (packed.packedQuantity > 0) {
          const packedBatch = await MedicineBatch.findOneAndUpdate(
            {
              _id: current._id,
              version: current.version,
              'quantities.picking': { $gte: item.quantity! },
            },
            {
              $inc: {
                'quantities.picking': -packed.packedQuantity,
                'quantities.packed': packed.packedQuantity,
                version: 1,
              },
            },
            { new: true, session },
          );
          if (!packedBatch) {
            throw Object.assign(new Error('Concurrent packing conflict'), {
              statusCode: 409,
              code: 'CONCURRENT_PACKING',
            });
          }
          await StockMovement.create(
            [
              {
                medicineId: item.medicineId!,
                batchId: item.batchId!,
                type: StockMovementType.PACKING,
                quantity: packed.packedQuantity,
                before: current.quantities,
                after: packedBatch.quantities,
                reason: packed.shortfallReason ?? 'Packing confirmed',
                referenceType: 'PickingList',
                referenceId: String(list._id),
                actorId: actor._id,
                actorRole: actor.role,
                idempotencyKey: `packing:${list._id}:${item.batchId}`,
              },
            ],
            { session },
          );
          current = packedBatch;
        }
        if (unused > 0) {
          const releasedBatch = await MedicineBatch.findOneAndUpdate(
            {
              _id: current._id,
              version: current.version,
              'quantities.picking': { $gte: unused },
            },
            {
              $inc: {
                'quantities.picking': -unused,
                'quantities.available': unused,
                version: 1,
              },
            },
            { new: true, session },
          );
          if (!releasedBatch) {
            throw Object.assign(new Error('Concurrent shortfall release conflict'), {
              statusCode: 409,
              code: 'CONCURRENT_PACKING',
            });
          }
          await StockMovement.create(
            [
              {
                medicineId: item.medicineId!,
                batchId: item.batchId!,
                type: StockMovementType.PICKING_RETURN,
                quantity: unused,
                before: current.quantities,
                after: releasedBatch.quantities,
                reason: packed.shortfallReason ?? 'Unused picking quantity released',
                referenceType: 'PickingList',
                referenceId: String(list._id),
                actorId: actor._id,
                actorRole: actor.role,
                idempotencyKey: `picking-return:${list._id}:${item.batchId}`,
              },
            ],
            { session },
          );
          current = releasedBatch;
        }
        const line = approval.lines.find(
          (value) => String(value.medicineId) === packed.medicineId,
        )!;
        const discount = prorateMinor(
          line.lineDiscountMinor ?? 0,
          packed.packedQuantity,
          line.approvedQuantity!,
        );
        const orderItem = order.items.find(
          (value) => String(value.medicineId) === packed.medicineId,
        )!;
        const lineGross = packed.packedQuantity * line.unitPriceMinor!;
        assertSafeMoney(lineGross, 'Packed line gross');
        const lineTotal = safeAdd(lineGross, -discount);
        invoiceItems.push({
          medicineId: item.medicineId,
          medicineSnapshot: orderItem.medicineSnapshot,
          batchId: batch._id,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          quantity: packed.packedQuantity,
          /*
           * Carried onto the invoice so the document can say "10 + 1 free".
           *
           * `quantity` is unchanged and `calculatePackedInvoice` never sees
           * this, which is the whole reason schemes could be added beside a
           * double-entry ledger without touching the money arithmetic.
           */
          freeQuantity: orderItem.freeQuantity ?? 0,
          unitPriceMinor: line.unitPriceMinor!,
          discountMinor: discount,
          lineTotalMinor: lineTotal,
        });
        priceLines.push({
          quantity: packed.packedQuantity,
          unitPriceMinor: line.unitPriceMinor!,
          discountMinor: discount,
        });
        item.packedQuantity = packed.packedQuantity;
        item.shortfallReason = packed.shortfallReason;
      }
      // Read once inside the transaction so the invoice, its tax and its
      // supplier snapshot all come from one consistent settings view.
      const settings = await getSettings();
      const taxRateBasisPoints = Math.max(0, settings.finance.taxBasisPoints);
      const math = calculatePackedInvoice(
        priceLines,
        approval.orderDiscountMinor,
        approval.deliveryChargeMinor,
        taxRateBasisPoints,
      );
      const { items: _calculatedItems, ...invoiceMath } = math;
      const previous = Math.max(0, await getLedgerBalance(shop._id, session));
      const [invoice] = await Invoice.create(
        [
          {
            reference: await nextReference('INV'),
            orderId: order._id,
            shopId: shop._id,
            supplierSnapshot: {
              name: settings.business.name,
              address: settings.business.address,
              phone: settings.business.phone,
              email: settings.business.email,
            },
            shopSnapshot: {
              reference: shop.reference,
              name: shop.name,
              phone: shop.primaryPhone,
              email: shop.email,
            },
            orderSnapshot: { reference: order.reference },
            billingAddressSnapshot: shop.billingAddress,
            deliveryAddressSnapshot: order.deliveryAddressSnapshot,
            items: invoiceItems,
            ...invoiceMath,
            previousBalanceMinor: previous,
            amountDueMinor: math.grandTotalMinor,
            totalOutstandingMinor: previous + math.grandTotalMinor,
            paymentTermsDays: shop.paymentTermsDays,
            invoiceDate: new Date(),
            dueDate: new Date(Date.now() + shop.paymentTermsDays * 86400000),
            footer: settings.business.invoiceFooter,
            issuedBy: actor._id,
            issuedAt: new Date(),
            // What this invoice is denominated in, recorded on it. The
            // symbol and the code are administrable; an issued invoice is not.
            currencySnapshot: currencySnapshot(),
          },
        ],
        { session },
      );
      await postInvoiceCharge(invoice, actor, session);
      if (order.requestedPaymentMethod === PaymentMethod.CREDIT) {
        const reservation = await CreditReservation.findOne({ orderId: order._id }).session(
          session,
        );
        if (reservation) {
          const consumed = await consumeCredit(
            order._id,
            { invoiceId: invoice._id, actualInvoiceMinor: math.grandTotalMinor },
            actor,
            session,
          );
          const projection = await Shop.findOneAndUpdate(
            {
              _id: shop._id,
              reservedCreditMinor: { $gte: reservation.approvedExposureMinor },
            },
            { $inc: { reservedCreditMinor: -reservation.approvedExposureMinor } },
            { new: true, session },
          );
          if (!projection) {
            throw Object.assign(new Error('Credit reservation projection is inconsistent'), {
              statusCode: 409,
              code: 'CREDIT_RESERVATION_DRIFT',
            });
          }
          void consumed;
        }
      }
      const [pack] = await Package.create(
        [
          {
            reference: await nextReference('PKG'),
            orderId: order._id,
            invoiceId: invoice._id,
            packageCount: input.packageCount,
            weightGrams: input.weightGrams,
            packedBy: actor._id,
            packedAt: new Date(),
            barcode: `PKG:${order.reference}:${invoice.reference}`,
            notes: input.notes,
          },
        ],
        { session },
      );
      if (!order.deliveryAddressSnapshot || !order.contactSnapshot) {
        throw Object.assign(new Error('Order delivery snapshot is incomplete'), {
          statusCode: 409,
          code: 'DELIVERY_SNAPSHOT_REQUIRED',
        });
      }
      const proofRequirements = await configuredProofRequirements();
      const [delivery] = await Delivery.create(
        [
          {
            reference: await nextReference('DEL'),
            orderId: order._id,
            packageId: pack._id,
            invoiceId: invoice._id,
            shopId: shop._id,
            addressSnapshot: order.deliveryAddressSnapshot,
            contactSnapshot: order.contactSnapshot,
            proofRequirements: proofRequirements,
            history: [
              {
                to: 'READY_FOR_ASSIGNMENT',
                actorId: actor._id,
                actorRole: actor.role,
                at: new Date(),
              },
            ],
          },
        ],
        { session },
      );
      list.status = 'PACKED';
      list.completedAt = new Date();
      list.version += 1;
      await list.save({ session });
      order.status = OrderStatus.READY_FOR_DELIVERY;
      order.version += 1;
      order.statusHistory.push(
        { from: OrderStatus.PACKING, to: OrderStatus.PACKED, actorId: actor._id, at: new Date() },
        {
          from: OrderStatus.PACKED,
          to: OrderStatus.INVOICE_GENERATED,
          actorId: actor._id,
          at: new Date(),
        },
        {
          from: OrderStatus.INVOICE_GENERATED,
          to: OrderStatus.READY_FOR_DELIVERY,
          actorId: actor._id,
          at: new Date(),
        },
      );
      await order.save({ session });
      await AuditLog.create(
        [
          {
            actorId: actor._id,
            actorRole: actor.role,
            action: 'PACKING_CONFIRMED_AND_INVOICE_ISSUED',
            entityType: 'Order',
            entityId: order._id,
            after: {
              invoiceId: invoice._id,
              packageId: pack._id,
              deliveryId: delivery._id,
              grandTotalMinor: math.grandTotalMinor,
            },
          },
        ],
        { session },
      );
      const managers = await userIdsWithRoles([UserRole.MANAGER, UserRole.ADMIN], session);
      const hasShortfall = list.items.some((item) => item.packedQuantity! < item.quantity!);
      await notify({
        event: NotificationEvent.INVOICE_ISSUED,
        recipientIds: [order.submittedBy, ...managers],
        context: {
          reference: invoice.reference,
          amountMinor: math.grandTotalMinor,
          orderId: String(order._id),
        },
        entityType: 'Invoice',
        entityId: invoice._id,
        session,
      });
      if (hasShortfall) {
        await notify({
          event: NotificationEvent.PACKING_SHORTFALL,
          recipientIds: managers,
          context: { reference: order.reference, orderId: String(order._id) },
          entityType: 'Order',
          entityId: order._id,
          occurrenceKey: `SHORTFALL:${invoice.reference}`,
          session,
        });
      }
      await recordActivity({
        action: 'INVOICE_ISSUED',
        category: NotificationCategory.FINANCE,
        entityType: ActivityEntityType.INVOICE,
        entityId: invoice._id,
        orderId: order._id,
        shopId: order.shopId as never,
        actor: { _id: actor._id, role: actor.role },
        summary: `Invoice ${invoice.reference} issued for order ${order.reference}`,
        detail: hasShortfall
          ? 'Packed quantities were below approved quantities; unused stock was released.'
          : undefined,
        metadata: { grandTotalMinor: math.grandTotalMinor },
        visibleToRoles: ActivityVisibility.fulfilment,
        visibleToShop: true,
        occurrenceKey: invoice.reference,
        session,
      });
      result = { list, invoice, package: pack, delivery };
    });
    return result;
  } finally {
    await session.endSession();
  }
}
