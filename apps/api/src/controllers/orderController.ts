import { NextFunction, Response } from 'express';
import {
  ActivityEntityType,
  NotificationCategory,
  NotificationEvent,
  OrderStatus,
  RealtimeEvent,
  ShopStatus,
  UserRole,
} from '@medsupply/shared-types';
import {
  CancellationDecisionSchema,
  CancellationRequestSchema,
  QuoteOrderSchema,
  SaveOrderDraftSchema,
  SubmitOrderSchema,
} from '@medsupply/validation';
import { AuthRequest } from '../middlewares/auth';
import { Order } from '../models/Order';
import { Shop } from '../models/Shop';
import { User } from '../models/User';
import { AuditLog } from '../models/AuditLog';
import { nextReference } from '../models/Counter';
import { buildOrderSnapshot } from '../services/orderService';
import { decideCancellation } from '../services/cancellationService';
import { notify } from '../services/notificationService';
import { ActivityVisibility, recordActivity } from '../services/activityService';
import { emitEntityUpdate } from '../services/realtime';
import { MANAGEMENT_ROLES, shopManagementIds } from '../services/notificationAudience';
import { correlationId } from '../services/logger';
import { decideOnBehalf } from '../services/onBehalfRules';

async function ownedShop(req: AuthRequest) {
  const shop = await Shop.findOne({ ownerIds: req.user!._id });
  if (!shop)
    throw Object.assign(new Error('No shop is assigned to this account'), {
      statusCode: 403,
      code: 'SHOP_REQUIRED',
    });
  return shop;
}

/**
 * The shop this order is for.
 *
 * A shop owner gets their own, exactly as before. Anybody else has to name one
 * and has to be allowed to act for it — which is what makes order-on-behalf a
 * feature rather than a hole. The decision is here rather than on the screen,
 * because a filter a client applies is a filter a client can drop.
 */
async function targetShop(req: AuthRequest, shopId?: string) {
  const role = req.user!.role as UserRole;
  if (role === UserRole.SHOP_OWNER || !shopId)
    return { shop: await ownedShop(req), onBehalf: false };

  const shop = await Shop.findById(shopId);
  if (!shop)
    throw Object.assign(new Error('Shop not found'), { statusCode: 404, code: 'NOT_FOUND' });

  const decision = decideOnBehalf(
    { role, territories: req.user!.territories },
    { territory: shop.territory },
  );
  if (!decision.allowed) {
    throw Object.assign(
      new Error(
        decision.code === 'SHOP_OUTSIDE_TERRITORY'
          ? 'That shop is not in your territory'
          : 'Your role cannot place an order for another shop',
      ),
      { statusCode: 403, code: decision.code },
    );
  }
  return { shop, onBehalf: true };
}
async function ownOrder(req: AuthRequest, id: string) {
  const order = await Order.findById(id);
  if (!order)
    throw Object.assign(new Error('Order not found'), { statusCode: 404, code: 'NOT_FOUND' });
  if (
    req.user!.role === UserRole.SHOP_OWNER &&
    String(order.shopId) !== String((await ownedShop(req))._id)
  )
    throw Object.assign(new Error('Access denied'), { statusCode: 403, code: 'FORBIDDEN' });
  return order;
}
async function audit(
  req: AuthRequest,
  action: string,
  order: InstanceType<typeof Order>,
  before?: unknown,
) {
  await AuditLog.create({
    actorId: req.user!._id,
    actorRole: req.user!.role,
    action,
    entityType: 'Order',
    entityId: order._id,
    before,
    after: order.toObject(),
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    correlationId: correlationId(),
  });
}

/**
 * What this customer would pay, without placing anything.
 *
 * Order entry has to show the operator the price the customer will actually be
 * charged while they are still typing, and that answer is the resolver's: the
 * shop's own arrangement, then whichever price list they are assigned, then the
 * medicine's default — plus any free-goods offer running on the line. A screen
 * that works the figure out for itself shows the operator one number and the
 * invoice another.
 *
 * Deliberately the **same** `buildOrderSnapshot` the draft and the submission
 * use, rather than a second implementation that would agree with it only until
 * one of them changed. Nothing is written and no reference is consumed.
 */
export async function quoteOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = QuoteOrderSchema.parse(req.body);
    const { shop, onBehalf } = await targetShop(req, input.shopId);
    const snapshot = await buildOrderSnapshot(shop._id, input);
    res.json({
      data: {
        shopId: String(shop._id),
        shopName: shop.name,
        shopReference: shop.reference,
        onBehalf,
        items: snapshot.items,
        estimatedSubtotalMinor: snapshot.estimatedSubtotalMinor,
        estimatedDiscountMinor: snapshot.estimatedDiscountMinor,
        estimatedDeliveryChargeMinor: snapshot.estimatedDeliveryChargeMinor,
        estimatedTotalMinor: snapshot.estimatedTotalMinor,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function saveDraft(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = SaveOrderDraftSchema.parse(req.body);
    const { shop, onBehalf } = await targetShop(req, input.shopId);
    const snapshot = await buildOrderSnapshot(shop._id, input);
    const order = await Order.create({
      reference: await nextReference('ORD'),
      shopId: shop._id,
      submittedBy: req.user!._id,
      placedBy: req.user!._id,
      placedOnBehalf: onBehalf,
      ...input,
      ...snapshot,
      status: OrderStatus.DRAFT,
      statusHistory: [{ to: OrderStatus.DRAFT, actorId: req.user!._id, at: new Date() }],
    });
    await audit(req, 'ORDER_DRAFT_CREATED', order);
    res.status(201).json({ data: order });
  } catch (error) {
    next(error);
  }
}
export async function updateDraft(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = SaveOrderDraftSchema.parse(req.body);
    const order = await ownOrder(req, String(req.params.id));
    if (order.status !== OrderStatus.DRAFT)
      return res
        .status(409)
        .json({ error: { code: 'ORDER_IMMUTABLE', message: 'Only draft orders can be edited' } });
    const snapshot = await buildOrderSnapshot(order.shopId, input);
    const before = order.toObject();
    Object.assign(order, input, snapshot);
    order.version += 1;
    await order.save();
    await audit(req, 'ORDER_DRAFT_UPDATED', order, before);
    res.json({ data: order });
  } catch (error) {
    next(error);
  }
}
export async function deleteDraft(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const order = await ownOrder(req, String(req.params.id));
    if (order.status !== OrderStatus.DRAFT)
      return res
        .status(409)
        .json({ error: { code: 'ORDER_IMMUTABLE', message: 'Only draft orders can be deleted' } });
    await audit(req, 'ORDER_DRAFT_DELETED', order);
    await order.deleteOne();
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
export async function submitOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = SubmitOrderSchema.parse(req.body);
    const duplicate = await Order.findOne({ submissionIdempotencyKey: input.idempotencyKey });
    if (duplicate) return res.json({ data: duplicate, meta: { idempotentReplay: true } });
    const { shop, onBehalf } = await targetShop(req, input.shopId);
    if (shop.status !== ShopStatus.ACTIVE)
      return res.status(409).json({
        error: {
          code: 'SHOP_BLOCKED',
          message: `Orders cannot be submitted while shop status is ${shop.status}`,
        },
      });
    const address = shop.deliveryAddresses.id(input.deliveryAddressId);
    if (!address)
      return res.status(400).json({
        error: { code: 'ADDRESS_REQUIRED', message: 'Select a valid saved delivery address' },
      });
    const snapshot = await buildOrderSnapshot(shop._id, input);
    if (snapshot.items.every((item) => item.availableStockSnapshot === 0))
      return res.status(409).json({
        error: {
          code: 'NO_AVAILABLE_PRODUCTS',
          message: 'All products in this order are unavailable',
        },
      });
    let order = req.params.id ? await ownOrder(req, String(req.params.id)) : null;
    if (order && order.status !== OrderStatus.DRAFT)
      return res.status(409).json({
        error: { code: 'ORDER_IMMUTABLE', message: 'This order has already been submitted' },
      });
    if (!order)
      order = new Order({
        reference: await nextReference('ORD'),
        shopId: shop._id,
        submittedBy: req.user!._id,
        // The record names the human. That, not the shape of the order, is
        // what makes placing one for somebody else auditable.
        placedBy: req.user!._id,
        placedOnBehalf: onBehalf,
        statusHistory: [],
      });
    /*
     * `shopId` is stripped from the input before it is assigned.
     *
     * `Object.assign(order, input, …)` copies whatever the client sent, so the
     * raw `shopId` would overwrite the one `targetShop` resolved — and a shop
     * owner naming somebody else's shop would have their order **reassigned to
     * it**, past the check that exists to prevent exactly that. Found by the
     * test written for the opposite case, which is the only reason it is not
     * shipping.
     */
    const { shopId: _requestedShopId, ...assignable } = input;
    Object.assign(order, assignable, snapshot, {
      shopId: shop._id,
      deliveryAddressSnapshot: address.toObject(),
      contactSnapshot: { name: shop.name, phone: shop.primaryPhone, email: shop.email },
      status: OrderStatus.SUBMITTED,
      submittedAt: new Date(),
      submissionIdempotencyKey: input.idempotencyKey,
    });
    order.statusHistory.push({
      from: OrderStatus.DRAFT,
      to: OrderStatus.SUBMITTED,
      actorId: req.user!._id,
      at: new Date(),
    });
    order.version += 1;
    await order.save();
    const admins = await User.find({
      role: { $in: [UserRole.SUPER_ADMIN, UserRole.ADMIN] },
      status: 'ACTIVE',
    }).select('_id');
    const recipients = [
      ...(shop.managerId ? [shop.managerId] : []),
      ...admins.map((user) => user._id),
      req.user!._id,
    ];
    await notify({
      event: NotificationEvent.ORDER_SUBMITTED,
      recipientIds: recipients,
      context: { reference: order.reference, shopName: shop.name, orderId: String(order._id) },
      entityType: 'Order',
      entityId: order._id,
    });
    await recordActivity({
      action: 'ORDER_SUBMITTED',
      category: NotificationCategory.ORDER,
      entityType: ActivityEntityType.ORDER,
      entityId: order._id,
      orderId: order._id,
      shopId: shop._id,
      actor: req.user,
      summary: `Order ${order.reference} submitted by ${shop.name}`,
      detail: `${order.items.length} line(s) requested.`,
      visibleToRoles: ActivityVisibility.internal,
      visibleToShop: true,
      occurrenceKey: OrderStatus.SUBMITTED,
    });
    emitEntityUpdate({
      event: RealtimeEvent.ORDER_UPDATED,
      entityType: ActivityEntityType.ORDER,
      entityId: order._id,
      reference: order.reference,
      status: order.status,
      orderId: order._id,
      shopId: shop._id,
      roles: MANAGEMENT_ROLES,
      notifyShop: true,
    });
    await audit(req, 'ORDER_SUBMITTED', order);
    res.status(201).json({ data: order });
  } catch (error) {
    next(error);
  }
}
export async function listOrders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1),
      limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const filter: Record<string, unknown> = {};
    if (req.user!.role === UserRole.SHOP_OWNER) filter.shopId = (await ownedShop(req))._id;
    // Compared as a value, never spread into the filter as a shape: a status
    // that arrives as anything but a plain string is ignored.
    if (typeof req.query.status === 'string') filter.status = req.query.status;
    const [data, total] = await Promise.all([
      // Read-only projection: these documents are serialised straight to the
      // response, so hydrating each one into a Mongoose model buys nothing.
      Order.find(filter)
        .populate('shopId', 'reference name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);
    res.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    next(error);
  }
}
export async function getOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await ownOrder(req, String(req.params.id)) });
  } catch (error) {
    next(error);
  }
}
export async function duplicateOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const source = await ownOrder(req, String(req.params.id));
    const input = {
      items: source.items.map((item) => ({
        medicineId: String(item.medicineId),
        requestedQuantity: item.requestedQuantity,
        shopNotes: item.shopNotes ?? undefined,
      })),
      purchaseOrderReference: undefined,
      shopNotes: source.shopNotes ?? undefined,
    };
    const shop = await ownedShop(req);
    const snapshot = await buildOrderSnapshot(shop._id, input);
    const order = await Order.create({
      reference: await nextReference('ORD'),
      shopId: shop._id,
      submittedBy: req.user!._id,
      ...input,
      ...snapshot,
      status: OrderStatus.DRAFT,
      statusHistory: [
        {
          to: OrderStatus.DRAFT,
          actorId: req.user!._id,
          at: new Date(),
          note: `Duplicated from ${source.reference}`,
        },
      ],
    });
    await audit(req, 'ORDER_DUPLICATED', order);
    res.status(201).json({ data: order });
  } catch (error) {
    next(error);
  }
}
export async function requestCancellation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { reason } = CancellationRequestSchema.parse(req.body);
    const order = await ownOrder(req, String(req.params.id));
    if (
      ![OrderStatus.SUBMITTED, OrderStatus.UNDER_REVIEW, OrderStatus.ON_HOLD].includes(
        order.status as
          | typeof OrderStatus.SUBMITTED
          | typeof OrderStatus.UNDER_REVIEW
          | typeof OrderStatus.ON_HOLD,
      )
    )
      return res.status(409).json({
        error: {
          code: 'CANCELLATION_NOT_ALLOWED',
          message: 'Cancellation is no longer available for this order',
        },
      });
    if (order.cancellationRequestedAt)
      return res.json({ data: order, meta: { idempotentReplay: true } });
    order.cancellationRequestedAt = new Date();
    order.cancellationReason = reason;
    await order.save();
    await notify({
      // Not ORDER_CANCELLED. Asking is not cancelling, and management acted on
      // the difference: they were told an order had been cancelled while the
      // warehouse went on picking it.
      event: NotificationEvent.ORDER_CANCELLATION_REQUESTED,
      recipientIds: await shopManagementIds(order.shopId as never),
      context: { reference: order.reference, reason, orderId: String(order._id) },
      entityType: 'Order',
      entityId: order._id,
      occurrenceKey: 'CANCELLATION_REQUESTED',
    });
    await recordActivity({
      action: 'ORDER_CANCELLATION_REQUESTED',
      category: NotificationCategory.ORDER,
      entityType: ActivityEntityType.ORDER,
      entityId: order._id,
      orderId: order._id,
      shopId: order.shopId as never,
      actor: req.user,
      summary: `Cancellation requested for order ${order.reference}`,
      detail: reason,
      visibleToRoles: ActivityVisibility.internal,
      visibleToShop: true,
      occurrenceKey: 'CANCELLATION_REQUESTED',
    });
    emitEntityUpdate({
      event: RealtimeEvent.ORDER_UPDATED,
      entityType: ActivityEntityType.ORDER,
      entityId: order._id,
      reference: order.reference,
      status: order.status,
      orderId: order._id,
      shopId: order.shopId as never,
      roles: MANAGEMENT_ROLES,
      notifyShop: true,
    });
    await audit(req, 'ORDER_CANCELLATION_REQUESTED', order);
    res.json({ data: order });
  } catch (error) {
    next(error);
  }
}

/**
 * Deciding a cancellation request.
 *
 * The counterpart that never existed. `ORDER_STATE_MACHINE.md` has promised the
 * controlled transition to `CANCELLED` since the fourth phase of the original
 * build; until now nothing anywhere set that status, so every cancellation
 * request was a dead end that had already told management the opposite.
 */
export async function decideCancellationRequest(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const input = CancellationDecisionSchema.parse(req.body);
    const result = await decideCancellation(String(req.params.id), input, {
      _id: req.user!._id,
      role: req.user!.role,
    });
    const order = result.order;

    await notify({
      event: input.approve
        ? NotificationEvent.ORDER_CANCELLED
        : NotificationEvent.ORDER_CANCELLATION_REFUSED,
      recipientIds: order.submittedBy ? [order.submittedBy] : [],
      context: {
        reference: order.reference,
        reason: input.reason,
        orderId: String(order._id),
      },
      entityType: 'Order',
      entityId: order._id,
      occurrenceKey: `CANCELLATION_DECIDED:${order.version}`,
    });

    await recordActivity({
      action: input.approve ? 'ORDER_CANCELLED' : 'ORDER_CANCELLATION_REFUSED',
      category: NotificationCategory.ORDER,
      entityType: ActivityEntityType.ORDER,
      entityId: order._id,
      orderId: order._id,
      shopId: order.shopId as never,
      actor: req.user,
      summary: input.approve
        ? `Order ${order.reference} was cancelled`
        : `Cancellation of order ${order.reference} was not granted`,
      detail: input.reason,
      visibleToRoles: ActivityVisibility.internal,
      visibleToShop: true,
      occurrenceKey: `CANCELLATION_DECIDED:${order.version}`,
    });

    emitEntityUpdate({
      event: RealtimeEvent.ORDER_UPDATED,
      entityType: ActivityEntityType.ORDER,
      entityId: order._id,
      reference: order.reference,
      status: order.status,
      orderId: order._id,
      shopId: order.shopId as never,
      roles: MANAGEMENT_ROLES,
      notifyShop: true,
    });

    res.json({
      data: order,
      meta: {
        idempotentReplay: result.idempotentReplay,
        // Reported so the reviewer can see what the decision gave back, rather
        // than having to trust that it did.
        releasedCreditMinor: result.releasedCreditMinor,
        releasedStockUnits: result.releasedStockUnits,
      },
    });
  } catch (error) {
    next(error);
  }
}
