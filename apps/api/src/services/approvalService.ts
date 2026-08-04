import mongoose, { Types } from 'mongoose';
import {
  OrderStatus,
  PaymentMethod,
  ShopStatus,
  StockMovementType,
  UserRole,
} from '@medsupply/shared-types';
import { Order } from '../models/Order';
import { Shop } from '../models/Shop';
import { MedicineBatch } from '../models/MedicineBatch';
import { StockMovement } from '../models/StockMovement';
import { OrderApproval } from '../models/OrderApproval';
import { PickingList } from '../models/PickingList';
import { planFefoAllocation } from './inventoryRules';
import { getCreditSummary } from './financeService';
import { reserveCredit } from './creditReservationService';
import { assertSafeMoney, safeAdd } from './financialMath';
type Actor = { _id: Types.ObjectId; role: UserRole };

/**
 * Who may approve an order past its credit limit.
 *
 * Exported so the clients can decide whether to render the control at all,
 * rather than offering a button that always fails.
 */
export const CREDIT_OVERRIDE_ROLES: readonly UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN];
type Input = {
  version: number;
  lines: Array<{
    orderItemId: string;
    approvedQuantity: number;
    unitPriceMinor: number;
    lineDiscountMinor: number;
  }>;
  orderDiscountMinor: number;
  deliveryChargeMinor: number;
  internalNotes?: string;
  shopOwnerNotes?: string;
  creditOverride: boolean;
};
export async function approveOrder(
  orderId: string,
  input: Input,
  actor: Actor,
): Promise<{ order: InstanceType<typeof Order>; approval: InstanceType<typeof OrderApproval> }> {
  const session = await mongoose.startSession();
  try {
    let result:
      | { order: InstanceType<typeof Order>; approval: InstanceType<typeof OrderApproval> }
      | undefined;
    await session.withTransaction(async () => {
      const order = await Order.findOne({
        _id: orderId,
        status: { $in: [OrderStatus.SUBMITTED, OrderStatus.UNDER_REVIEW, OrderStatus.ON_HOLD] },
        version: input.version,
      }).session(session);
      if (!order)
        throw Object.assign(new Error('Order changed or is no longer approvable'), {
          statusCode: 409,
          code: 'STALE_ORDER',
        });
      const shop = await Shop.findById(order.shopId).session(session);
      if (
        !shop ||
        !([ShopStatus.ACTIVE, ShopStatus.CREDIT_BLOCKED] as ShopStatus[]).includes(
          shop.status as ShopStatus,
        )
      )
        throw Object.assign(new Error('Shop is not eligible for approval'), {
          statusCode: 409,
          code: 'SHOP_BLOCKED',
        });
      if (shop.drugLicenceExpiryDate && shop.drugLicenceExpiryDate <= new Date())
        throw Object.assign(new Error('Shop drug licence is expired'), {
          statusCode: 409,
          code: 'LICENCE_EXPIRED',
        });
      const approved = [];
      let subtotal = 0;
      for (const lineInput of input.lines) {
        const item = order.items.id(lineInput.orderItemId);
        if (!item)
          throw Object.assign(new Error('Order item not found'), {
            statusCode: 400,
            code: 'INVALID_ITEM',
          });
        if (lineInput.approvedQuantity > item.requestedQuantity)
          throw Object.assign(new Error('Approved quantity exceeds requested quantity'), {
            statusCode: 400,
            code: 'INVALID_QUANTITY',
          });
        if (!lineInput.approvedQuantity) continue;
        const gross = lineInput.unitPriceMinor * lineInput.approvedQuantity;
        assertSafeMoney(gross, 'Approved line gross');
        if (lineInput.lineDiscountMinor > gross)
          throw Object.assign(new Error('Line discount exceeds line amount'), {
            statusCode: 400,
            code: 'INVALID_DISCOUNT',
          });
        const batches = await MedicineBatch.find({
          medicineId: item.medicineId,
          isBlocked: false,
          isQuarantined: false,
          expiryDate: { $gt: new Date() },
          'quantities.available': { $gt: 0 },
        })
          .sort({ expiryDate: 1 })
          .session(session);
        let plan;
        try {
          plan = planFefoAllocation(
            batches.map((batch) => ({
              id: String(batch._id),
              expiryDate: batch.expiryDate,
              available: batch.quantities.available,
              isBlocked: batch.isBlocked,
              isQuarantined: batch.isQuarantined,
            })),
            /*
             * The chargeable quantity **plus** the free units.
             *
             * This is the one line where a scheme touches stock: the warehouse
             * has to pick eleven for a 10+1, and the shelf has to be reduced by
             * eleven. Everything downstream still prices `approvedQuantity`, so
             * the money does not move — only the dispatched count does.
             */
            lineInput.approvedQuantity + (item.freeQuantity ?? 0),
          );
        } catch {
          throw Object.assign(
            new Error(`Insufficient stock for ${item.medicineSnapshot.brandName}`),
            { statusCode: 409, code: 'INSUFFICIENT_STOCK' },
          );
        }
        const allocations = [];
        for (const allocation of plan) {
          const before = batches.find((batch) => String(batch._id) === allocation.batchId)!;
          const updated = await MedicineBatch.findOneAndUpdate(
            {
              _id: before._id,
              version: before.version,
              'quantities.available': { $gte: allocation.quantity },
            },
            {
              $inc: {
                'quantities.available': -allocation.quantity,
                'quantities.reserved': allocation.quantity,
                version: 1,
              },
            },
            { new: true, session },
          );
          if (!updated)
            throw Object.assign(new Error('Concurrent stock change'), {
              statusCode: 409,
              code: 'CONCURRENT_STOCK_CHANGE',
            });
          await StockMovement.create(
            [
              {
                medicineId: item.medicineId,
                batchId: before._id,
                type: StockMovementType.RESERVATION,
                quantity: allocation.quantity,
                before: before.quantities,
                after: updated.quantities,
                reason: 'Manager order approval',
                referenceType: 'Order',
                referenceId: String(order._id),
                actorId: actor._id,
                actorRole: actor.role,
                idempotencyKey: `approval:${order._id}:${before._id}`,
              },
            ],
            { session },
          );
          allocations.push({ batchId: before._id, quantity: allocation.quantity });
        }
        const lineTotal = gross - lineInput.lineDiscountMinor;
        subtotal = safeAdd(subtotal, lineTotal);
        approved.push({
          orderItemId: item._id,
          medicineId: item.medicineId,
          requestedQuantity: item.requestedQuantity,
          approvedQuantity: lineInput.approvedQuantity,
          unitPriceMinor: lineInput.unitPriceMinor,
          lineDiscountMinor: lineInput.lineDiscountMinor,
          lineTotalMinor: lineTotal,
          allocations,
        });
      }
      if (!approved.length)
        throw Object.assign(new Error('At least one item must be approved'), {
          statusCode: 400,
          code: 'ZERO_APPROVAL',
        });
      const total = safeAdd(subtotal, -input.orderDiscountMinor, input.deliveryChargeMinor);
      if (total < 0)
        throw Object.assign(new Error('Invalid order discount'), {
          statusCode: 400,
          code: 'INVALID_DISCOUNT',
        });
      let creditOverrideApplied = false;
      if (order.requestedPaymentMethod === PaymentMethod.CREDIT) {
        const currentReserved = shop.reservedCreditMinor ?? 0;
        const credit = await getCreditSummary(String(shop._id), {
          proposedExposureMinor: total,
          reservedExposureMinor: currentReserved,
          session,
        });
        if (credit.orderBlocked && !input.creditOverride) {
          throw Object.assign(new Error(credit.blockReasons.join('; ')), {
            statusCode: 409,
            code: credit.limitExceeded ? 'CREDIT_LIMIT' : 'CREDIT_BLOCKED',
          });
        }
        if (credit.orderBlocked && input.creditOverride) {
          /**
           * Overriding a credit block is a decision to extend unsecured credit
           * past an agreed limit, so it belongs to whoever carries that risk.
           *
           * Two documents disagreed and the code matched neither:
           * `PHASE_STATUS.md:166` recorded the intent as Admin and Super Admin
           * only, `PERMISSIONS.md:29` said Managers as well, and the service
           * applied **no role check at all** — any approver could grant one with
           * a five-character reason. Settled as the stricter of the two, which
           * is also the documented intent, and `PERMISSIONS.md` is corrected to
           * match. Downgrading it later is a policy change somebody makes
           * deliberately; leaving it undecided is how it stayed open.
           */
          if (!CREDIT_OVERRIDE_ROLES.includes(actor.role)) {
            throw Object.assign(
              new Error(
                'Only an administrator can approve an order past its credit limit. ' +
                  'Ask an administrator to review it.',
              ),
              { statusCode: 403, code: 'CREDIT_OVERRIDE_FORBIDDEN' },
            );
          }
          const reason = input.internalNotes?.trim() ?? '';
          if (reason.length < 5) {
            throw Object.assign(
              new Error('A meaningful internal reason is required for credit override'),
              {
                statusCode: 400,
                code: 'CREDIT_OVERRIDE_REASON_REQUIRED',
              },
            );
          }
          creditOverrideApplied = true;
        }
        const reservationLock = await Shop.findOneAndUpdate(
          {
            _id: shop._id,
            $or: [
              { reservedCreditMinor: currentReserved },
              ...(currentReserved === 0 ? [{ reservedCreditMinor: { $exists: false } }] : []),
            ],
          },
          { $inc: { reservedCreditMinor: total } },
          { new: true, session },
        );
        if (!reservationLock) {
          throw Object.assign(
            new Error('Credit exposure changed concurrently; review the order again'),
            {
              statusCode: 409,
              code: 'CONCURRENT_CREDIT_CHANGE',
            },
          );
        }
        await reserveCredit(
          {
            orderId: order._id,
            shopId: shop._id,
            approvedExposureMinor: total,
            decisionSnapshot: {
              creditLimitMinor: credit.creditLimitMinor,
              outstandingMinor: credit.outstandingMinor,
              reservedMinor: currentReserved,
              overdueMinor: credit.overdueMinor,
              availableCreditMinor: credit.availableCreditMinor,
              proposedExposureMinor: total,
              blockedReasons: credit.blockReasons,
              capturedAt: new Date(),
            },
            override: creditOverrideApplied
              ? { applied: true, reason: input.internalNotes!.trim() }
              : { applied: false },
          },
          actor,
          session,
        );
      }
      const full =
        approved.length === order.items.length &&
        approved.every((line) => line.approvedQuantity === line.requestedQuantity);
      const status = full ? OrderStatus.APPROVED : OrderStatus.PARTIALLY_APPROVED;
      const [approval] = await OrderApproval.create(
        [
          {
            orderId: order._id,
            managerId: actor._id,
            decision: status,
            lines: approved,
            orderDiscountMinor: input.orderDiscountMinor,
            deliveryChargeMinor: input.deliveryChargeMinor,
            subtotalMinor: subtotal,
            totalMinor: total,
            internalNotes: input.internalNotes,
            shopOwnerNotes: input.shopOwnerNotes,
            creditOverride: creditOverrideApplied,
          },
        ],
        { session },
      );
      await PickingList.create(
        [
          {
            orderId: order._id,
            approvalId: approval._id,
            items: approved.flatMap((line) =>
              line.allocations.map((allocation) => ({
                medicineId: line.medicineId,
                batchId: allocation.batchId,
                quantity: allocation.quantity,
              })),
            ),
          },
        ],
        { session },
      );
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, version: input.version },
        {
          $set: { status },
          $inc: { version: 1 },
          $push: {
            statusHistory: {
              from: order.status,
              to: status,
              actorId: actor._id,
              at: new Date(),
              note: input.shopOwnerNotes,
            },
          },
        },
        { new: true, session },
      );
      if (!updated)
        throw Object.assign(new Error('Order changed concurrently'), {
          statusCode: 409,
          code: 'STALE_ORDER',
        });
      result = { order: updated, approval };
    });
    if (!result) throw new Error('Approval transaction produced no result');
    return result;
  } finally {
    await session.endSession();
  }
}
