import { NextFunction, Response } from 'express';
import {
  DiscrepancyResolutionSchema,
  DiscrepancySchema,
  PackingSchema,
  PickingActionSchema,
  PickingProgressSchema,
} from '@medsupply/validation';
import {
  ActivityEntityType,
  NotificationCategory,
  NotificationEvent,
  RealtimeEvent,
  UserRole,
} from '@medsupply/shared-types';
import { AuthRequest } from '../middlewares/auth';
import { PickingList } from '../models/PickingList';
import { Invoice } from '../models/Invoice';
import { Package } from '../models/Package';
import { Shop } from '../models/Shop';
import { AuditLog } from '../models/AuditLog';
import {
  packAndInvoice,
  recordPickingProgress,
  resumePicking,
  startPicking,
} from '../services/fulfilmentService';
import { createSimplePdf } from '../services/pdfService';
import { notify } from '../services/notificationService';
import { ActivityVisibility, recordActivity } from '../services/activityService';
import { emitEntityUpdate } from '../services/realtime';
import { MANAGEMENT_ROLES, userIdsWithRoles } from '../services/notificationAudience';
const actor = (req: AuthRequest) => ({ _id: req.user!._id, role: req.user!.role as UserRole });
async function permittedInvoice(req: AuthRequest) {
  const value = await Invoice.findById(req.params.id);
  if (
    value &&
    req.user!.role === UserRole.SHOP_OWNER &&
    !(await Shop.exists({ _id: value.shopId, ownerIds: req.user!._id }))
  )
    throw Object.assign(new Error('Access denied'), { statusCode: 403, code: 'FORBIDDEN' });
  return value;
}
export async function queue(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const pickingQuery = PickingList.find();
    if (status) pickingQuery.where('status').equals(status);
    const data = await pickingQuery
      .populate({ path: 'orderId', populate: { path: 'shopId', select: 'reference name' } })
      .sort({ createdAt: 1 })
      .limit(200);
    res.json({ data });
  } catch (error) {
    next(error);
  }
}
export async function detail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const list = await PickingList.findById(req.params.id)
      .populate({ path: 'orderId', populate: { path: 'shopId' } })
      .populate('items.medicineId', 'reference barcode brandName genericName strength');
    if (!list)
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'Picking list not found' } });
    res.json({ data: list });
  } catch (error) {
    next(error);
  }
}
export async function start(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({
      data: await startPicking(
        String(req.params.id),
        PickingActionSchema.parse(req.body).version,
        actor(req),
      ),
    });
  } catch (error) {
    next(error);
  }
}
export async function discrepancy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = DiscrepancySchema.parse(req.body);
    const { version, ...reported } = input;
    const current = await PickingList.findOne({
      _id: req.params.id,
      version,
      status: { $in: ['PICKING', 'PAUSED', 'PACKING'] },
    });
    if (!current) {
      return res.status(409).json({
        error: { code: 'STALE_PICKING', message: 'Picking list changed or cannot be blocked' },
      });
    }
    const list = await PickingList.findOneAndUpdate(
      {
        _id: req.params.id,
        version,
        status: current.status,
      },
      {
        $push: {
          discrepancies: {
            ...reported,
            status: 'OPEN',
            reportedBy: req.user!._id,
            reportedAt: new Date(),
          },
        },
        $set: { status: 'BLOCKED_DISCREPANCY', blockedFromStatus: current.status },
        $inc: { version: 1 },
      },
      { new: true },
    );
    if (!list) {
      return res.status(409).json({
        error: { code: 'STALE_PICKING', message: 'Picking list changed or cannot be blocked' },
      });
    }
    await AuditLog.create({
      actorId: req.user!._id,
      actorRole: req.user!.role,
      action: 'PICKING_DISCREPANCY_REPORTED',
      entityType: 'PickingList',
      entityId: list._id,
      after: input,
    });
    await notify({
      event: NotificationEvent.PICKING_DISCREPANCY,
      recipientIds: await userIdsWithRoles([UserRole.MANAGER, UserRole.ADMIN]),
      context: { note: input.notes, pickingListId: String(list._id) },
      entityType: 'PickingList',
      entityId: list._id,
      occurrenceKey: `REPORTED:${list.version}`,
    });
    await recordActivity({
      action: 'PICKING_DISCREPANCY_REPORTED',
      category: NotificationCategory.FULFILMENT,
      entityType: ActivityEntityType.PICKING_LIST,
      entityId: list._id,
      orderId: list.orderId as never,
      actor: req.user,
      summary: `Picking discrepancy reported: ${input.type.replaceAll('_', ' ').toLowerCase()}`,
      detail: input.notes,
      visibleToRoles: ActivityVisibility.fulfilment,
      occurrenceKey: `REPORTED:${list.version}`,
    });
    emitEntityUpdate({
      event: RealtimeEvent.FULFILMENT_UPDATED,
      entityType: ActivityEntityType.PICKING_LIST,
      entityId: list._id,
      status: list.status,
      orderId: list.orderId as never,
      roles: [...MANAGEMENT_ROLES, UserRole.STOREKEEPER],
    });
    res.json({ data: list });
  } catch (error) {
    next(error);
  }
}

export async function progress(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({
      data: await recordPickingProgress(
        String(req.params.id),
        PickingProgressSchema.parse(req.body),
        actor(req),
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function resume(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({
      data: await resumePicking(
        String(req.params.id),
        PickingActionSchema.parse(req.body).version,
        actor(req),
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function resolveDiscrepancy(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = DiscrepancyResolutionSchema.parse(req.body);
    const now = new Date();
    const current = await PickingList.findOne({
      _id: req.params.id,
      version: input.version,
      status: 'BLOCKED_DISCREPANCY',
      'discrepancies.status': 'OPEN',
    });
    if (!current) {
      return res.status(409).json({
        error: { code: 'STALE_PICKING', message: 'Discrepancy changed or is already resolved' },
      });
    }
    const restoredStatus = current.blockedFromStatus ?? 'PICKING';
    const list = await PickingList.findOneAndUpdate(
      {
        _id: req.params.id,
        version: input.version,
        status: 'BLOCKED_DISCREPANCY',
        'discrepancies.status': 'OPEN',
      },
      {
        $set: {
          status: restoredStatus,
          'discrepancies.$[open].status': 'RESOLVED',
          'discrepancies.$[open].resolutionNotes': input.resolutionNotes,
          'discrepancies.$[open].resolvedBy': req.user!._id,
          'discrepancies.$[open].resolvedAt': now,
        },
        $unset: { blockedFromStatus: 1 },
        $inc: { version: 1 },
      },
      { new: true, arrayFilters: [{ 'open.status': 'OPEN' }] },
    );
    if (!list) {
      return res.status(409).json({
        error: { code: 'STALE_PICKING', message: 'Discrepancy changed or is already resolved' },
      });
    }
    await AuditLog.create({
      actorId: req.user!._id,
      actorRole: req.user!.role,
      action: 'PICKING_DISCREPANCY_RESOLVED',
      entityType: 'PickingList',
      entityId: list._id,
      after: { resolutionNotes: input.resolutionNotes, status: list.status },
    });
    await notify({
      event: NotificationEvent.PICKING_DISCREPANCY_RESOLVED,
      recipientIds: list.startedBy ? [list.startedBy] : [],
      context: { note: input.resolutionNotes, pickingListId: String(list._id) },
      entityType: 'PickingList',
      entityId: list._id,
      occurrenceKey: `RESOLVED:${list.version}`,
    });
    await recordActivity({
      action: 'PICKING_DISCREPANCY_RESOLVED',
      category: NotificationCategory.FULFILMENT,
      entityType: ActivityEntityType.PICKING_LIST,
      entityId: list._id,
      orderId: list.orderId as never,
      actor: req.user,
      summary: 'Picking discrepancy resolved',
      detail: input.resolutionNotes,
      visibleToRoles: ActivityVisibility.fulfilment,
      occurrenceKey: `RESOLVED:${list.version}`,
    });
    emitEntityUpdate({
      event: RealtimeEvent.FULFILMENT_UPDATED,
      entityType: ActivityEntityType.PICKING_LIST,
      entityId: list._id,
      status: list.status,
      orderId: list.orderId as never,
      roles: [...MANAGEMENT_ROLES, UserRole.STOREKEEPER],
    });
    res.json({ data: list });
  } catch (error) {
    next(error);
  }
}
export async function pack(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({
      data: await packAndInvoice(String(req.params.id), PackingSchema.parse(req.body), actor(req)),
    });
  } catch (error) {
    next(error);
  }
}
export async function invoice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const value = await permittedInvoice(req);
    if (!value)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invoice not found' } });
    res.json({ data: value });
  } catch (error) {
    next(error);
  }
}
export async function pdf(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const value = await permittedInvoice(req);
    if (!value) return res.status(404).end();
    const money = (minor: number | undefined) => `${((minor ?? 0) / 100).toFixed(2)} BDT`;
    const address = (value: unknown) =>
      value && typeof value === 'object'
        ? Object.values(value as Record<string, unknown>)
            .filter((part) => typeof part === 'string' && part.length > 0)
            .join(', ')
        : '';
    const layout = req.query.layout === 'thermal' ? 'THERMAL' : 'A4';
    const lines = [
      String(value.supplierSnapshot?.name ?? 'MedSupply B2B'),
      String(value.supplierSnapshot?.address ?? ''),
      `${String(value.supplierSnapshot?.phone ?? '')} ${String(value.supplierSnapshot?.email ?? '')}`,
      `Invoice ${value.reference}`,
      `Order ${String(value.orderSnapshot?.reference ?? value.orderId)}`,
      `Date ${value.invoiceDate?.toISOString().slice(0, 10)}`,
      `Due ${value.dueDate?.toISOString().slice(0, 10)} (${value.paymentTermsDays ?? 0} days)`,
      `Customer ${String(value.shopSnapshot?.name ?? '')} ${String(value.shopSnapshot?.phone ?? '')}`,
      `Billing ${address(value.billingAddressSnapshot)}`,
      `Delivery ${address(value.deliveryAddressSnapshot)}`,
      'Medicine / batch / expiry / qty / unit / discount / total',
      ...value.items.map(
        (item) =>
          `${item.medicineSnapshot?.brandName} / ${item.batchNumber} / ${item.expiryDate?.toISOString().slice(0, 10)} / ${item.quantity} / ${money(item.unitPriceMinor)} / ${money(item.discountMinor)} / ${money(item.lineTotalMinor)}`,
      ),
      `Subtotal ${money(value.subtotalMinor)}`,
      `Order discount ${money(value.orderDiscountMinor)}`,
      `Delivery charge ${money(value.deliveryChargeMinor)}`,
      `Tax ${money(value.taxMinor)}`,
      `Grand total ${money(value.grandTotalMinor)}`,
      `Previous balance ${money(value.previousBalanceMinor)}`,
      `Amount paid ${money(value.amountPaidMinor)}`,
      `Current due ${money(value.amountDueMinor)}`,
      `Total outstanding ${money(value.totalOutstandingMinor)}`,
      '',
      'Authorised signature: ____________________',
      value.footer ?? '',
    ];
    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `inline; filename="${value.reference}.pdf"`)
      .send(createSimplePdf(lines, layout));
  } catch (error) {
    next(error);
  }
}
export async function ready(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({
      data: await Package.find({ handoverStatus: 'AWAITING_HANDOVER' })
        .populate('orderId', 'reference status')
        .populate('invoiceId', 'reference grandTotalMinor')
        .sort({ packedAt: 1 }),
    });
  } catch (error) {
    next(error);
  }
}
