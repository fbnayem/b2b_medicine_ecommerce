import { NextFunction, Response } from 'express';
import { Types } from 'mongoose';
import {
  ActivityEntityType,
  ContentLanguage,
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
import { alternativesFor } from '../services/alternativesService';
import { categoryTree } from '../services/categoryService';
import { contentFor, searchContent } from '../services/medicineContentService';
import { medicineListPipeline } from '../services/medicineListQuery';
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
 * How many products a monograph search may put in front of somebody.
 *
 * `hypertension` is mentioned by thousands of monographs, and a fallback that
 * answered with thousands would not be an answer — it would be the catalogue
 * again, in a different order. Two hundred is the same bound `searchContent`
 * enforces on itself, named here so the page arithmetic and the service agree.
 */
const CONTENT_SEARCH_CAP = 200;

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
    /*
     * A whole branch rather than one leaf.
     *
     * `category` matches the leaf exactly, which is right for "show me Face
     * Wash" and useless for "show me everything under Beauty" — and until the
     * trail was stored there was no way to ask the second question at all.
     * Multi-key index, so the depth the word sits at does not matter.
     */
    const branch = stringParam(req.query.branch);
    if (branch) filter.categoryPath = branch;
    /*
     * An unanchored, case-insensitive substring match, kept deliberately.
     *
     * The obvious optimisation is the collection's own text index, and it was
     * measured rather than assumed: across twenty terms a pharmacy actually
     * types, a `$text` and prefix union returned **2,718 fewer products** than
     * this does. `amox` stops finding `Co-amoxiclav`, `losar` stops finding
     * `Repace Losar`. Warm, the substring query costs 30 ms for a page of
     * twenty against 55,999 products; the text index would save roughly ten of
     * those milliseconds and cost the matches. The index scan is the price of
     * finding a drug by the middle of its name.
     */
    const search = stringParam(req.query.search);
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      filter.$or = [
        { brandName: pattern },
        { genericName: pattern },
        { manufacturer: pattern },
        { sku: pattern },
        { barcode: pattern },
      ];
    }
    /*
     * Two orders and no more: alphabetical for finding a line whose name is
     * known, and the supplier's demand ranking for browsing — each backed by
     * exactly one index, which is the condition for adding one at all.
     * Anything unrecognised reads as the default rather than an error, the
     * same stance every other filter on this endpoint takes.
     */
    const sort = req.query.sort === 'popular' ? 'popular' : 'name';
    const listPage = (where: Record<string, unknown>) =>
      Promise.all([
        Medicine.aggregate(medicineListPipeline(where, page, limit, sort)),
        Medicine.countDocuments(where),
      ]);
    let [items, total] = await listPage(filter);

    /*
     * What a drug treats is not written on the product row.
     *
     * `typhoid` names no brand, no manufacturer and no ingredient, so a name
     * search for it returns nothing at all while 79,904 monographs sit in the
     * database saying which medicines treat it. Searching that prose costs
     * 451–1,568 ms — far too much to spend on every keystroke — so it runs
     * only where it can do no harm: when the catalogue itself matched nothing,
     * which is the request that was going to render an empty screen anyway.
     *
     * `matchedIn` travels with the result because a list that quietly changed
     * what it was searching would be lying about why these products are here.
     */
    let matchedIn: 'name' | 'productInformation' | undefined = search ? 'name' : undefined;
    if (search && total === 0) {
      const mentioned = await searchContent(search, CONTENT_SEARCH_CAP);
      if (mentioned.length) {
        delete filter.$or;
        filter._id = { $in: mentioned };
        matchedIn = 'productInformation';
        [items, total] = await listPage(filter);
      }
    }

    const data = items.map((item) => hideCosts(item, req.user!.role));
    res.json({
      data,
      meta: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        ...(matchedIn ? { matchedIn } : {}),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * The shelf hierarchy, as it actually stands.
 *
 * Cheap enough to compute per request — one grouping over an indexed field,
 * 997 distinct paths — and computing it is the point: a cached or stored tree
 * is one that can disagree with the catalogue.
 */
export async function listCategories(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const activeOnly = req.user!.role === UserRole.SHOP_OWNER || req.query.active === 'true';
    res.json({ data: await categoryTree(activeOnly) });
  } catch (error) {
    next(error);
  }
}

/**
 * What else this shop could be sent instead.
 *
 * A separate request from `getMedicine` rather than a field on it, because the
 * detail screen is opened constantly during order entry and five extra
 * aggregations on every one of those would be paid whether or not anybody
 * scrolled far enough to see them.
 *
 * A shop owner sees only active products and never a cost price — the same two
 * rules the rest of this controller applies, restated here because a suggestion
 * list is exactly the sort of secondary surface where a hidden field quietly
 * reappears.
 */
export async function getMedicineAlternatives(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const medicine = await Medicine.findById(req.params.id).lean();
    if (!medicine || (req.user!.role === UserRole.SHOP_OWNER && !medicine.isActive))
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Medicine not found' } });

    const groups = await alternativesFor(medicine);
    res.json({
      data: groups.map((group) => ({
        kind: group.kind,
        items: group.items.map((item) => hideCosts(item, req.user!.role)),
      })),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * The supplier's monograph for one product — separate from `getMedicine` for
 * the same reason the alternatives are: it is kilobytes of prose the order-entry
 * screens never scroll to, and the whole reason it lives in its own collection
 * is that the catalogue reads should not carry it.
 *
 * The existence check mirrors `getMedicine` exactly, so a shop owner cannot
 * learn a delisted line exists by asking for its copy instead of its record.
 * A product with no copy answers `data: null` with a 200: the medicine was
 * found, and "we have no monograph for this" is a fact about it, not a missing
 * resource.
 */
export async function getMedicineContent(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const medicine = await Medicine.findById(req.params.id).lean();
    if (!medicine || (req.user!.role === UserRole.SHOP_OWNER && !medicine.isActive))
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Medicine not found' } });

    /*
     * Anything that is not Bangla reads as English rather than erroring: a
     * mistyped `lang` on a product page should degrade to the language nearly
     * every monograph has, not put a validation error where a monograph goes.
     */
    const lang = req.query.lang === ContentLanguage.BN ? ContentLanguage.BN : ContentLanguage.EN;
    res.json({ data: await contentFor(medicine._id, lang) });
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
