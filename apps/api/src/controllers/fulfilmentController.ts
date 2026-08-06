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
import { MedicineBatch } from '../models/MedicineBatch';
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
import { formatDate, formatMoneyMinor, formatQuantity } from '@medsupply/utilities';
import { documentFormatSettings } from '../services/localisation';
import { createDocumentPdf } from '../services/pdfService';
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
    /*
     * A comma-separated list, not a single value.
     *
     * "Orders to pick" is five statuses — pending, being picked, paused, being
     * packed, and blocked on a discrepancy — and there was no way to ask for
     * them together. So the home screen asked for the whole table and counted
     * it, which meant fourteen finished picks were reported as work waiting for
     * a storekeeper. Approvals has taken a list since it was written; this
     * matches it rather than inventing a second convention.
     */
    const status = req.query.status ? String(req.query.status).split(',') : undefined;
    const pickingQuery = PickingList.find();
    if (status) pickingQuery.where('status').in(status);
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

    /*
     * U11: the picker's Batch column rendered the raw 24-character ObjectId.
     * AGENTS.md forbids exposing MongoDB ids as a visible reference, and more
     * to the point a warehouse picker cannot check a hex string against a
     * carton — the number printed on the box is the batch number.
     *
     * Sent alongside rather than populated over `batchId`: the client posts
     * that id straight back when recording progress, so replacing it with a
     * document would break picking to fix a label.
     */
    const batches = await MedicineBatch.find({
      _id: { $in: list.items.map((item) => item.batchId).filter(Boolean) },
    }).select('batchNumber expiryDate');

    res.json({
      data: {
        ...list.toObject(),
        batchNumbers: Object.fromEntries(
          batches.map((batch) => [
            String(batch._id),
            { batchNumber: batch.batchNumber, expiryDate: batch.expiryDate },
          ]),
        ),
      },
    });
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
    const address = (part: unknown) =>
      part && typeof part === 'object'
        ? Object.values(part as Record<string, unknown>)
            .filter((piece) => typeof piece === 'string' && piece.length > 0)
            .join(', ')
        : '';
    const layout = req.query.layout === 'thermal' ? 'THERMAL' : 'A4';

    /*
     * Every amount and date below goes through the shared formatters. They were
     * built in Phase 1 and adopted by both clients; the server kept its own
     * `(minor / 100).toFixed(2)` and `toISOString().slice(0, 10)`, so the
     * documents the business actually issues were the last place in the system
     * printing ungrouped money and a UTC calendar date.
     */
    /*
     * The currency this invoice was issued in, from the invoice.
     *
     * Not from the live settings: `currencyCode` and `currencySymbol` are
     * administrable, so rendering from them would mean a PDF regenerated next
     * year carried a different symbol from the paper the customer signed for.
     * Invoices issued before the snapshot existed fall back to the live
     * settings, which is what they were rendered with anyway.
     */
    const money = documentFormatSettings(
      value.currencySnapshot as { code?: string; symbol?: string } | undefined,
    );

    const pdfBuffer = await createDocumentPdf(
      {
        brand: String(value.supplierSnapshot?.name ?? 'MedSupply B2B'),
        brandLines: [
          String(value.supplierSnapshot?.address ?? ''),
          [value.supplierSnapshot?.phone, value.supplierSnapshot?.email]
            .filter((part) => typeof part === 'string' && part.length > 0)
            .join(' · '),
        ],
        title: `Invoice ${value.reference}`,
        facts: [
          ['Order', String(value.orderSnapshot?.reference ?? value.orderId)],
          ['Invoice date', formatDate(value.invoiceDate)],
          ['Customer', String(value.shopSnapshot?.name ?? '')],
          ['Due', `${formatDate(value.dueDate)} (${value.paymentTermsDays ?? 0} days)`],
          ['Phone', String(value.shopSnapshot?.phone ?? '')],
          ['Billing', address(value.billingAddressSnapshot)],
          ['Delivery', address(value.deliveryAddressSnapshot)],
        ],
        table: {
          columns: [
            { header: 'Medicine', width: 30 },
            { header: 'Batch', width: 14 },
            { header: 'Expiry', width: 13 },
            { header: 'Qty', width: 8, align: 'right' },
            { header: 'Unit', width: 12, align: 'right' },
            { header: 'Discount', width: 11, align: 'right' },
            { header: 'Total', width: 12, align: 'right' },
          ],
          rows: value.items.map((item) => [
            String(item.medicineSnapshot?.brandName ?? ''),
            item.batchNumber,
            formatDate(item.expiryDate),
            // "10 + 1 free" where a scheme applied; just the quantity where
            // none did, so nothing changes on an ordinary invoice.
            item.freeQuantity
              ? `${formatQuantity(item.quantity)} + ${formatQuantity(item.freeQuantity)} free`
              : formatQuantity(item.quantity),
            formatMoneyMinor(item.unitPriceMinor, money),
            formatMoneyMinor(item.discountMinor, money),
            formatMoneyMinor(item.lineTotalMinor, money),
          ]),
        },
        totals: [
          { label: 'Subtotal', value: formatMoneyMinor(value.subtotalMinor, money) },
          { label: 'Order discount', value: formatMoneyMinor(value.orderDiscountMinor, money) },
          { label: 'Delivery charge', value: formatMoneyMinor(value.deliveryChargeMinor, money) },
          { label: 'Tax', value: formatMoneyMinor(value.taxMinor, money) },
          {
            label: 'Grand total',
            value: formatMoneyMinor(value.grandTotalMinor, money),
            strong: true,
          },
          { label: 'Previous balance', value: formatMoneyMinor(value.previousBalanceMinor, money) },
          { label: 'Amount paid', value: formatMoneyMinor(value.amountPaidMinor, money) },
          { label: 'Current due', value: formatMoneyMinor(value.amountDueMinor, money) },
          {
            label: 'Total outstanding',
            value: formatMoneyMinor(value.totalOutstandingMinor, money),
            strong: true,
          },
        ],
        footer: ['', 'Authorised signature: ____________________', value.footer ?? ''],
        pageNote: `Invoice ${value.reference}`,
      },
      layout,
    );

    res
      .type('application/pdf')
      .setHeader('Content-Disposition', `inline; filename="${value.reference}.pdf"`)
      .send(pdfBuffer);
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
