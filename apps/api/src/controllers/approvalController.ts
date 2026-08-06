import { NextFunction, Response } from 'express';
import {
  ActivityEntityType,
  NotificationCategory,
  NotificationEvent,
  APPROVAL_QUEUE,
  OrderStatus,
  RealtimeEvent,
  UserRole,
} from '@medsupply/shared-types';
import {
  ApprovalSchema,
  HoldOrderSchema,
  RejectOrderSchema,
  ReviewVersionSchema,
} from '@medsupply/validation';
import { AuthRequest } from '../middlewares/auth';
import { logger } from '../services/logger';
import { Order } from '../models/Order';
import { OrderApproval } from '../models/OrderApproval';
import { MedicineBatch } from '../models/MedicineBatch';
import { Shop } from '../models/Shop';
import { AuditLog } from '../models/AuditLog';
import { CREDIT_OVERRIDE_ROLES, approveOrder } from '../services/approvalService';
import { getCreditSummary } from '../services/financeService';
import { notify } from '../services/notificationService';
import { ActivityVisibility, recordActivity } from '../services/activityService';
import { emitEntityUpdate } from '../services/realtime';
import { MANAGEMENT_ROLES, userIdsWithRoles } from '../services/notificationAudience';

/** Order status to the notification event that announces it. */
const TRANSITION_EVENTS: Partial<Record<OrderStatus, NotificationEvent>> = {
  [OrderStatus.UNDER_REVIEW]: NotificationEvent.ORDER_UNDER_REVIEW,
  [OrderStatus.ON_HOLD]: NotificationEvent.ORDER_ON_HOLD,
  [OrderStatus.REJECTED]: NotificationEvent.ORDER_REJECTED,
  [OrderStatus.SUBMITTED]: NotificationEvent.ORDER_SUBMITTED,
};
const actor = (req: AuthRequest) => ({ _id: req.user!._id, role: req.user!.role as UserRole });
async function transition(req: AuthRequest, to: OrderStatus, version: number, note: string) {
  const allowed =
    to === OrderStatus.UNDER_REVIEW
      ? [OrderStatus.SUBMITTED]
      : to === OrderStatus.SUBMITTED
        ? [OrderStatus.UNDER_REVIEW, OrderStatus.ON_HOLD]
        : [OrderStatus.SUBMITTED, OrderStatus.UNDER_REVIEW, OrderStatus.ON_HOLD];
  const before = await Order.findOne({ _id: req.params.id, status: { $in: allowed }, version });
  if (!before)
    throw Object.assign(new Error('Order changed or action is not allowed'), {
      statusCode: 409,
      code: 'STALE_ORDER',
    });
  const order = await Order.findOneAndUpdate(
    { _id: before._id, version },
    {
      $set: { status: to },
      $inc: { version: 1 },
      $push: {
        statusHistory: { from: before.status, to, actorId: req.user!._id, at: new Date(), note },
      },
    },
    { new: true },
  );
  if (!order)
    throw Object.assign(new Error('Order changed concurrently'), {
      statusCode: 409,
      code: 'STALE_ORDER',
    });
  await AuditLog.create({
    actorId: req.user!._id,
    actorRole: req.user!.role,
    action: `ORDER_${to}`,
    entityType: 'Order',
    entityId: order._id,
    before: before.toObject(),
    after: order.toObject(),
  });
  const event = TRANSITION_EVENTS[to];
  if (event) {
    await notify({
      event,
      recipientIds: [order.submittedBy],
      context: {
        reference: order.reference,
        note,
        status: to,
        orderId: String(order._id),
        actorName: [req.user!.firstName, req.user!.lastName].filter(Boolean).join(' '),
      },
      entityType: 'Order',
      entityId: order._id,
      // The same order can be held, clarified and held again.
      occurrenceKey: `${to}:${order.version}`,
    });
  }
  await recordActivity({
    action: `ORDER_${to}`,
    category: NotificationCategory.APPROVAL,
    entityType: ActivityEntityType.ORDER,
    entityId: order._id,
    orderId: order._id,
    shopId: order.shopId as never,
    actor: req.user,
    summary: `Order ${order.reference}: ${to.replaceAll('_', ' ').toLowerCase()}`,
    detail: note,
    visibleToRoles: ActivityVisibility.internal,
    visibleToShop: true,
    occurrenceKey: `${to}:${order.version}`,
  });
  emitEntityUpdate({
    event: RealtimeEvent.APPROVAL_UPDATED,
    entityType: ActivityEntityType.ORDER,
    entityId: order._id,
    reference: order.reference,
    status: order.status,
    orderId: order._id,
    shopId: order.shopId as never,
    roles: MANAGEMENT_ROLES,
    notifyShop: true,
  });
  return order;
}
export async function queue(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    /*
     * `APPROVAL_QUEUE` rather than a list written out here.
     *
     * This default is deliberately broad — a manager wants to see what they
     * recently decided as well as what is waiting — and the home screen used to
     * count it and call the number "orders waiting for your decision". The
     * split between the two halves now lives in `shared-types`, so the screen
     * counting a subset of this list cannot fall out of step with it.
     */
    const status = req.query.status ? String(req.query.status).split(',') : [...APPROVAL_QUEUE];
    res.json({
      data: await Order.find()
        .where('status')
        .in(status)
        .populate(
          'shopId',
          'reference name status creditLimit outstandingBalance paymentTermsDays drugLicenceExpiryDate',
        )
        .sort({ submittedAt: 1 })
        .limit(200),
    });
  } catch (error) {
    next(error);
  }
}
export async function reviewDetail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const order = await Order.findById(req.params.id).populate('shopId');
    if (!order)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    const stock = await MedicineBatch.aggregate([
      {
        $match: {
          medicineId: { $in: order.items.map((item) => item.medicineId) },
          isBlocked: false,
          isQuarantined: false,
          expiryDate: { $gt: new Date() },
        },
      },
      {
        $group: {
          _id: '$medicineId',
          available: { $sum: '$quantities.available' },
          batches: {
            $push: {
              batchNumber: '$batchNumber',
              expiryDate: '$expiryDate',
              available: '$quantities.available',
            },
          },
        },
      },
    ]);
    const history = await Order.find({
      shopId: order.shopId,
      status: { $ne: OrderStatus.DRAFT },
      _id: { $ne: order._id },
    })
      .select('reference status estimatedTotalMinor createdAt')
      .sort({ createdAt: -1 })
      .limit(10);
    /*
     * The reviewer's credit position comes from the same function the approval
     * itself enforces with.
     *
     * `ApprovalReview.tsx` was computing `creditLimit - outstandingBalance`
     * locally, which ignores `reservedCreditMinor` — the exposure of other
     * orders already approved and not yet invoiced — so the screen could show
     * comfortable headroom while the server refused the approval. It also never
     * rendered `blockReasons`, so a manager facing a blocked order was told
     * only that it failed.
     */
    const credit = await getCreditSummary(String(order.shopId._id ?? order.shopId), {
      proposedExposureMinor: order.estimatedTotalMinor ?? 0,
    });

    res.json({
      data: {
        order,
        stock,
        history,
        credit,
        // So the client can offer the override control only to somebody who may
        // actually use it, rather than a button that always fails.
        canOverrideCredit: CREDIT_OVERRIDE_ROLES.includes(req.user!.role),
        approvals: await OrderApproval.find({ orderId: order._id }),
      },
    });
  } catch (error) {
    next(error);
  }
}
export async function start(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { version } = ReviewVersionSchema.parse(req.body);
    res.json({ data: await transition(req, OrderStatus.UNDER_REVIEW, version, 'Review started') });
  } catch (error) {
    next(error);
  }
}
export async function hold(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = HoldOrderSchema.parse(req.body);
    res.json({
      data: await transition(
        req,
        OrderStatus.ON_HOLD,
        input.version,
        input.shopOwnerNotes ?? input.reason,
      ),
    });
  } catch (error) {
    next(error);
  }
}
export async function reject(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = RejectOrderSchema.parse(req.body);
    const order = await transition(
      req,
      OrderStatus.REJECTED,
      input.version,
      input.shopOwnerNotes ?? input.reason,
    );
    await OrderApproval.create({
      orderId: order._id,
      managerId: req.user!._id,
      decision: 'REJECTED',
      reason: input.reason,
      internalNotes: input.internalNotes,
      shopOwnerNotes: input.shopOwnerNotes,
    });
    res.json({ data: order });
  } catch (error) {
    next(error);
  }
}
export async function approve(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await approveOrder(
      String(req.params.id),
      ApprovalSchema.parse(req.body),
      actor(req),
    );
    const approved = result!.order;
    await notify({
      event: NotificationEvent.ORDER_APPROVED,
      recipientIds: [approved.submittedBy],
      context: {
        reference: approved.reference,
        status: approved.status,
        orderId: String(approved._id),
      },
      entityType: 'Order',
      entityId: approved._id,
      occurrenceKey: `${approved.status}:${approved.version}`,
    });
    const storekeepers = await userIdsWithRoles([UserRole.STOREKEEPER]);
    await notify({
      event: NotificationEvent.PICKING_READY,
      recipientIds: storekeepers,
      context: { reference: approved.reference, orderId: String(approved._id) },
      entityType: 'Order',
      entityId: approved._id,
      occurrenceKey: `READY:${approved.version}`,
    });
    await recordActivity({
      action: 'ORDER_APPROVED',
      category: NotificationCategory.APPROVAL,
      entityType: ActivityEntityType.ORDER,
      entityId: approved._id,
      orderId: approved._id,
      shopId: approved.shopId as never,
      actor: req.user,
      summary: `Order ${approved.reference} ${approved.status.replaceAll('_', ' ').toLowerCase()}`,
      detail: 'Stock was reserved and a picking list was created.',
      visibleToRoles: ActivityVisibility.fulfilment,
      visibleToShop: true,
      occurrenceKey: `${approved.status}:${approved.version}`,
    });
    emitEntityUpdate({
      event: RealtimeEvent.APPROVAL_UPDATED,
      entityType: ActivityEntityType.ORDER,
      entityId: approved._id,
      reference: approved.reference,
      status: approved.status,
      orderId: approved._id,
      shopId: approved.shopId as never,
      roles: [...MANAGEMENT_ROLES, UserRole.STOREKEEPER],
      notifyShop: true,
    });
    await AuditLog.create({
      actorId: req.user!._id,
      actorRole: req.user!.role,
      action: 'ORDER_APPROVED',
      entityType: 'Order',
      entityId: result.order._id,
      after: result.order.toObject(),
    });
    res.json({ data: result });
  } catch (error) {
    await announceCreditBlock(req, error);
    next(error);
  }
}

/**
 * A credit refusal aborts the approval transaction, so it cannot be announced
 * from inside it. The shop still needs to know why its order stalled.
 */
async function announceCreditBlock(req: AuthRequest, error: unknown) {
  const code = (error as { code?: string }).code;
  if (code !== 'CREDIT_LIMIT' && code !== 'CREDIT_BLOCKED') return;
  try {
    const order = await Order.findById(req.params.id).select('reference shopId').lean();
    if (!order) return;
    const shop = await Shop.findById(order.shopId).select('name ownerIds').lean();
    if (!shop) return;
    const reason = error instanceof Error ? error.message : 'Credit checks blocked this order';
    await notify({
      event: NotificationEvent.CREDIT_BLOCKED,
      recipientIds: [
        ...((shop.ownerIds as never[]) ?? []),
        ...(await userIdsWithRoles(MANAGEMENT_ROLES)),
      ],
      context: {
        shopName: shop.name as string,
        reason,
        shopId: String(order.shopId),
        reference: order.reference as string,
      },
      entityType: 'Shop',
      entityId: order.shopId as never,
      occurrenceKey: `${order.reference}:${code}`,
    });
    await recordActivity({
      action: 'ORDER_CREDIT_BLOCKED',
      category: NotificationCategory.FINANCE,
      entityType: ActivityEntityType.ORDER,
      entityId: order._id,
      orderId: order._id,
      shopId: order.shopId as never,
      actor: req.user,
      summary: `Approval blocked by credit control for ${order.reference}`,
      detail: reason,
      visibleToRoles: ActivityVisibility.management,
      visibleToShop: true,
      occurrenceKey: `${order.reference}:${code}`,
    });
  } catch (announceError) {
    // Never let a notification failure mask the original approval error.
    logger.error('failed to announce a credit block', { error: announceError });
  }
}
export async function clarify(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = HoldOrderSchema.parse(req.body);
    res.json({
      data: await transition(
        req,
        OrderStatus.SUBMITTED,
        input.version,
        input.shopOwnerNotes ?? input.reason,
      ),
    });
  } catch (error) {
    next(error);
  }
}
