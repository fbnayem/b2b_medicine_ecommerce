import { NextFunction, Response } from 'express';
import { Types } from 'mongoose';
import { StockMovementType, UserRole } from '@medsupply/shared-types';
import {
  AdjustmentSchema,
  AllocationSchema,
  CreateMedicineSchema,
  ReceiveStockSchema,
  StockOperationSchema,
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
import { escapeRegex } from '../services/requestSanitiser';

const COST_ROLES = new Set<UserRole>([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER]);
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
const objectIdParam = (value: unknown): string | undefined =>
  typeof value === 'string' && Types.ObjectId.isValid(value) ? value : undefined;

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
    res.status(201).json({ data: medicine });
  } catch (error) {
    next(error);
  }
}

export async function updateMedicine(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = UpdateMedicineSchema.parse(req.body);
    const before = await Medicine.findById(req.params.id).lean();
    const medicine = await Medicine.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
    });
    if (!medicine)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Medicine not found' } });
    await audit(req, 'MEDICINE_UPDATED', 'Medicine', medicine._id, before, medicine.toObject());
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
    res.status(201).json({ data: await receiveStock(data, actor(req)) });
  } catch (error) {
    next(error);
  }
}

export async function operate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = StockOperationSchema.parse(req.body);
    res.json({ data: await applyStockOperation(String(req.params.id), data, actor(req)) });
  } catch (error) {
    next(error);
  }
}

export async function adjust(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = AdjustmentSchema.parse(req.body);
    res.json({
      data: await adjustStock(
        String(req.params.id),
        data.newOnHand,
        data.reason,
        data.idempotencyKey,
        actor(req),
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function setBatchBlock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (
      typeof req.body.blocked !== 'boolean' ||
      typeof req.body.reason !== 'string' ||
      req.body.reason.trim().length < 3
    )
      return res.status(400).json({
        error: { code: 'VALIDATION_FAILED', message: 'Blocked flag and reason are required' },
      });
    const batch = await MedicineBatch.findByIdAndUpdate(
      req.params.id,
      { isBlocked: req.body.blocked, notes: req.body.reason },
      { new: true },
    );
    if (!batch)
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Batch not found' } });
    await audit(
      req,
      req.body.blocked ? 'BATCH_BLOCKED' : 'BATCH_UNBLOCKED',
      'MedicineBatch',
      batch._id,
      undefined,
      { isBlocked: batch.isBlocked, reason: req.body.reason },
    );
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
