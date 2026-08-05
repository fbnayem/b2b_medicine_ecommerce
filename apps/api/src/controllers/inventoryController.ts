import { NextFunction, Response } from 'express';
import { Types } from 'mongoose';
import {
  ActivityEntityType,
  RealtimeEvent,
  StockMovementType,
  UserRole,
} from '@medsupply/shared-types';
import {
  AdjustmentSchema,
  BatchBlockSchema,
  AllocationSchema,
  CreateMedicineSchema,
  ReceiveStockSchema,
  StockOperationSchema,
  TRADE_ABOVE_MRP_MESSAGE,
  tradePriceExceedsMrp,
  UpdateMedicineSchema,
} from '@medsupply/validation';
import { AuthRequest } from '../middlewares/auth';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { StockMovement } from '../models/StockMovement';
import { nextReference } from '../models/Counter';
import { AuditLog } from '../models/AuditLog';
import {
  adjustStock,
  applyStockOperation,
  receiveStock,
  reserveFefo,
} from '../services/inventoryService';
import { inventorySettings } from '../services/settingsService';
import { correlationId } from '../services/logger';
import { escapeRegex, objectIdParam } from '../services/requestSanitiser';
import { emitEntityUpdate } from '../services/realtime';

const COST_ROLES = new Set<UserRole>([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER]);

/**
 * Who hears that the catalogue or the stock behind it moved.
 *
 * `INVENTORY_UPDATED` has been in `RealtimeEvent` since the realtime phase and
 * **nothing has ever emitted it**. It matters now because this is the release
 * that lets somebody change a price or correct a count from the medicine page:
 * without a push, a rep quoting a customer and a storekeeper picking against
 * the same line go on reading a figure that changed thirty seconds ago.
 *
 * Not shop owners. Their catalogue is served fresh on navigation, and the shop
 * room exists to tell a customer about their *own* orders — broadcasting every
 * warehouse movement into it would be both noise and a disclosure.
 */
const INVENTORY_AUDIENCE = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.STOREKEEPER,
  UserRole.SALES,
];

function announceInventory(
  entityType: ActivityEntityType,
  entityId: unknown,
  reference?: string,
): void {
  emitEntityUpdate({
    event: RealtimeEvent.INVENTORY_UPDATED,
    entityType,
    entityId: entityId as never,
    reference,
    roles: INVENTORY_AUDIENCE,
  });
}
const actor = (req: AuthRequest) => ({
  _id: req.user!._id as Types.ObjectId,
  role: req.user!.role as UserRole,
});

/**
 * A query value that is only ever compared to an identifier.
 *
 * Returning `undefined` for anything that is not a well-formed identifier means
 * a filter built from one either matches by equality or is left out, and can
 * never become an operator object or a value Mongoose will refuse to cast.
 */
/** A query value that is only ever compared as a string. */
const stringParam = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= 120 ? value : undefined;

function hideCosts<T extends Record<string, unknown>>(value: T, role: UserRole): T {
  if (COST_ROLES.has(role)) return value;
  const safe = { ...value };
  delete safe.costPriceMinor;
  return safe;
}

async function audit(
  req: AuthRequest,
  action: string,
  entityType: string,
  entityId: Types.ObjectId,
  before?: unknown,
  after?: unknown,
) {
  await AuditLog.create({
    actorId: req.user!._id,
    actorRole: req.user!.role,
    action,
    entityType,
    entityId,
    before,
    after,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    correlationId: correlationId(),
  });
}

export async function createMedicine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = CreateMedicineSchema.parse(req.body);
    const medicine = await Medicine.create({
      ...data,
      reference: await nextReference('MED'),
      createdBy: req.user!._id,
    });
    await audit(req, 'MEDICINE_CREATED', 'Medicine', medicine._id, undefined, medicine.toObject());
    announceInventory(ActivityEntityType.MEDICINE, medicine._id, medicine.reference);
    res.status(201).json({ data: medicine });
  } catch (error) {
    next(error);
  }
}

export async function updateMedicine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = UpdateMedicineSchema.parse(req.body);
    const before = await Medicine.findById(req.params.id).lean();

    /*
     * The schema sees only the patch, so raising the trade price on its own
     * passes a check that never saw the stored MRP — and a price above the
     * figure printed on the pack means the pharmacy loses money on every unit
     * it sells. Merged, the same rule applies to a partial edit.
     */
    if (
      before &&
      tradePriceExceedsMrp(
        data.mrpMinor ?? before.mrpMinor,
        data.defaultSellingPriceMinor ?? before.defaultSellingPriceMinor,
      )
    ) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: TRADE_ABOVE_MRP_MESSAGE,
          details: [{ path: 'defaultSellingPriceMinor', message: TRADE_ABOVE_MRP_MESSAGE }],
        },
      });
    }
    const medicine = await Medicine.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
    });
    if (!medicine)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Medicine not found' } });
    await audit(req, 'MEDICINE_UPDATED', 'Medicine', medicine._id, before, medicine.toObject());
    announceInventory(ActivityEntityType.MEDICINE, medicine._id, medicine.reference);
    res.json({ data: medicine });
  } catch (error) {
    next(error);
  }
}

export async function listMedicines(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const filter: Record<string, unknown> = {};
    if (req.user!.role === UserRole.SHOP_OWNER || req.query.active === 'true')
      filter.isActive = true;
    const category = stringParam(req.query.category);
    if (category) filter.category = category;
    if (req.query.search) {
      const search = new RegExp(escapeRegex(String(req.query.search)), 'i');
      filter.$or = [
        { brandName: search },
        { genericName: search },
        { manufacturer: search },
        { sku: search },
        { barcode: search },
      ];
    }
    const [items, total] = await Promise.all([
      Medicine.aggregate([
        { $match: filter },
        {
          $lookup: {
            from: 'medicinebatches',
            let: { medicineId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$medicineId', '$$medicineId'] },
                  isBlocked: false,
                  isQuarantined: false,
                  expiryDate: { $gt: new Date() },
                },
              },
              { $group: { _id: null, total: { $sum: '$quantities.available' } } },
            ],
            as: 'stock',
          },
        },
        { $set: { totalAvailable: { $ifNull: [{ $first: '$stock.total' }, 0] } } },
        { $unset: 'stock' },
        { $sort: { brandName: 1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ]),
      Medicine.countDocuments(filter),
    ]);
    const data = items.map((item) => hideCosts(item, req.user!.role));
    res.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    next(error);
  }
}

export async function getMedicine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const medicine = await Medicine.findById(req.params.id).lean();
    if (!medicine || (req.user!.role === UserRole.SHOP_OWNER && !medicine.isActive))
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Medicine not found' } });
    const stock = await MedicineBatch.aggregate([
      {
        $match: {
          medicineId: medicine._id,
          isBlocked: false,
          isQuarantined: false,
          expiryDate: { $gt: new Date() },
        },
      },
      { $group: { _id: null, total: { $sum: '$quantities.available' } } },
    ]);
    res.json({
      data: hideCosts({ ...medicine, totalAvailable: stock[0]?.total ?? 0 }, req.user!.role),
    });
  } catch (error) {
    next(error);
  }
}

export async function listBatches(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter: Record<string, unknown> = {};
    const medicineId = objectIdParam(req.query.medicineId);
    if (medicineId) filter.medicineId = medicineId;
    if (req.query.warning === 'expired') filter.expiryDate = { $lte: new Date() };
    const inventoryDefaults = await inventorySettings();
    if (req.query.warning === 'near-expiry') {
      const days = Math.min(
        365,
        Math.max(1, Number(req.query.days) || inventoryDefaults.nearExpiryDays),
      );
      filter.expiryDate = { $gt: new Date(), $lte: new Date(Date.now() + days * 86400000) };
    }
    if (req.query.warning === 'low-stock')
      filter['quantities.available'] = {
        $lte: Math.max(0, Number(req.query.threshold) || inventoryDefaults.lowStockThreshold),
      };
    const batches = await MedicineBatch.find(filter)
      .populate('medicineId', 'reference sku brandName genericName')
      .sort({ expiryDate: 1 })
      .limit(500)
      .lean();
    res.json({ data: batches.map((batch) => hideCosts(batch, req.user!.role)) });
  } catch (error) {
    next(error);
  }
}

export async function getBatch(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const batch = await MedicineBatch.findById(req.params.id)
      .populate('medicineId', 'reference sku brandName genericName')
      .lean();
    if (!batch)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Batch not found' } });
    res.json({ data: hideCosts(batch, req.user!.role) });
  } catch (error) {
    next(error);
  }
}

export async function receive(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = ReceiveStockSchema.parse(req.body);
    if (!(await Medicine.exists({ _id: data.medicineId })))
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Medicine not found' } });
    const received = await receiveStock(data, actor(req));
    announceInventory(ActivityEntityType.MEDICINE_BATCH, data.medicineId);
    res.status(201).json({ data: received });
  } catch (error) {
    next(error);
  }
}

export async function operate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = StockOperationSchema.parse(req.body);
    const moved = await applyStockOperation(String(req.params.id), data, actor(req));
    announceInventory(ActivityEntityType.MEDICINE_BATCH, req.params.id);
    res.json({ data: moved });
  } catch (error) {
    next(error);
  }
}

export async function adjust(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = AdjustmentSchema.parse(req.body);
    const adjusted = await adjustStock(
      String(req.params.id),
      data.newOnHand,
      data.reason,
      data.idempotencyKey,
      actor(req),
    );
    announceInventory(ActivityEntityType.MEDICINE_BATCH, req.params.id);
    res.json({ data: adjusted });
  } catch (error) {
    next(error);
  }
}

export async function setBatchBlock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = BatchBlockSchema.parse(req.body);
    const batch = await MedicineBatch.findByIdAndUpdate(
      req.params.id,
      { isBlocked: data.blocked, notes: data.reason },
      { new: true },
    );
    if (!batch)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Batch not found' } });
    await audit(
      req,
      data.blocked ? 'BATCH_BLOCKED' : 'BATCH_UNBLOCKED',
      'MedicineBatch',
      batch._id,
      undefined,
      { isBlocked: batch.isBlocked, reason: data.reason },
    );
    // Blocking removes the batch from what can be sold, so the availability
    // every other screen shows is wrong until they hear about it.
    announceInventory(ActivityEntityType.MEDICINE_BATCH, batch._id, batch.batchNumber);
    res.json({ data: batch });
  } catch (error) {
    next(error);
  }
}

export async function allocate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = AllocationSchema.parse(req.body);
    res.json({
      data: await reserveFefo(
        data.medicineId,
        data.quantity,
        data.idempotencyKey,
        data.referenceType,
        data.referenceId,
        actor(req),
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function listMovements(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const filter: Record<string, unknown> = {};
    const medicineId = objectIdParam(req.query.medicineId);
    if (medicineId) filter.medicineId = medicineId;
    const batchId = objectIdParam(req.query.batchId);
    if (batchId) filter.batchId = batchId;
    if (
      req.query.type &&
      Object.values(StockMovementType).includes(req.query.type as StockMovementType)
    )
      filter.type = req.query.type;
    const [data, total] = await Promise.all([
      StockMovement.find(filter)
        .populate('medicineId', 'reference sku brandName')
        .populate('batchId', 'batchNumber')
        .populate('actorId', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      StockMovement.countDocuments(filter),
    ]);
    res.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    next(error);
  }
}
