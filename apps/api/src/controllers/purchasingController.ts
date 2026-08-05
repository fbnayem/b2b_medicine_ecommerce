import type { NextFunction, Response } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  CreatePurchaseOrderSchema,
  CreateSupplierSchema,
  ReceiveGoodsSchema,
} from '@medsupply/validation';
import type { AuthRequest } from '../middlewares/auth';
import { AuditLog } from '../models/AuditLog';
import { GoodsReceipt } from '../models/GoodsReceipt';
import { PurchaseOrder } from '../models/PurchaseOrder';
import { Supplier } from '../models/Supplier';
import { nextReference } from '../models/Counter';
import { createPurchaseOrder, receiveGoods } from '../services/purchasingService';
import { findBatchesByNumber, traceBatch } from '../services/recallService';
import {
  controlledSubstanceByShop,
  controlledSubstanceRegister,
} from '../services/controlledSubstanceService';
import { containsFilter } from '../services/requestSanitiser';

function actor(req: AuthRequest) {
  return { _id: req.user!._id, role: req.user!.role as UserRole };
}

export async function listSuppliers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const filter: Record<string, unknown> =
      req.query.includeInactive === 'true' ? {} : { isActive: true };
    /*
     * A search, because the picker that reads this could not see past fifty.
     *
     * Every form that chooses a supplier read one unpaged page of fifty and
     * said nothing about the rest, so a distributor with more suppliers than
     * that simply could not raise an order against the ones below the cut. The
     * term is escaped through `containsFilter` — it was a user-controlled
     * pattern on `/shops` once, and that is not a mistake worth making twice.
     */
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const term = containsFilter(req.query.search.trim());
      filter.$or = [{ name: term }, { reference: term }, { contactName: term }];
    }

    const [items, total] = await Promise.all([
      Supplier.find(filter)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Supplier.countDocuments(filter),
    ]);
    res.json({ data: { items, total, page, limit } });
  } catch (error) {
    next(error);
  }
}

export async function createSupplier(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = CreateSupplierSchema.parse(req.body);
    const supplier = await Supplier.create({
      ...input,
      reference: await nextReference('SUP'),
      createdBy: req.user!._id,
    });
    await AuditLog.create({
      actorId: req.user!._id,
      actorRole: req.user!.role,
      action: 'SUPPLIER_CREATED',
      entityType: 'Supplier',
      entityId: supplier._id,
      after: { reference: supplier.reference, name: supplier.name },
    });
    res.status(201).json({ data: supplier });
  } catch (error) {
    next(error);
  }
}

export async function listPurchaseOrders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.supplierId) filter.supplierId = String(req.query.supplierId);

    const [items, total] = await Promise.all([
      PurchaseOrder.find(filter)
        .populate('supplierId', 'reference name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      PurchaseOrder.countDocuments(filter),
    ]);
    res.json({ data: { items, total, page, limit } });
  } catch (error) {
    next(error);
  }
}

export async function getPurchaseOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const order = await PurchaseOrder.findById(req.params.id).populate('supplierId');
    if (!order) {
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'Purchase order not found' } });
    }
    const receipts = await GoodsReceipt.find({ purchaseOrderId: order._id }).sort({
      receivedAt: 1,
    });
    res.json({ data: { order, receipts } });
  } catch (error) {
    next(error);
  }
}

export async function raisePurchaseOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = CreatePurchaseOrderSchema.parse(req.body);
    const order = await createPurchaseOrder(input, actor(req));
    res.status(201).json({ data: order });
  } catch (error) {
    next(error);
  }
}

export async function receiveAgainstOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = ReceiveGoodsSchema.parse(req.body);
    const receipt = await receiveGoods(
      { ...input, purchaseOrderId: String(req.params.id) },
      actor(req),
    );
    res.status(201).json({ data: receipt });
  } catch (error) {
    next(error);
  }
}

/**
 * The trace itself. A GET, because looking a batch up must never commit anybody
 * to anything — that is what makes it safe to check.
 */
export async function batchTrace(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await traceBatch(String(req.params.batchId)) });
  } catch (error) {
    next(error);
  }
}

/**
 * Finds candidate batches by the number printed on the carton, because whoever
 * raises a recall is holding a supplier notice, not a database identifier.
 */
export async function batchLookup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await findBatchesByNumber(String(req.query.batchNumber ?? '')) });
  } catch (error) {
    next(error);
  }
}

/**
 * The controlled-substance movement return.
 *
 * `MedicineClassification` has been stored on every medicine since the
 * catalogue phase and read by nothing at all.
 */
export async function controlledRegister(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from
      ? new Date(String(req.query.from))
      : new Date(to.getTime() - 30 * 86_400_000);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      return res.status(400).json({
        error: { code: 'INVALID_PERIOD', message: 'Give a start date before the end date.' },
      });
    }

    const [register, byShop] = await Promise.all([
      controlledSubstanceRegister({ from, to }),
      controlledSubstanceByShop({ from, to }),
    ]);
    res.json({ data: { ...register, byShop } });
  } catch (error) {
    next(error);
  }
}
