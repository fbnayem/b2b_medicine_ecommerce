import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middlewares/auth';
import { Shop } from '../models/Shop';
import { CreateShopSchema, UpdateShopSchema } from '@medsupply/validation';
import { ShopStatus, UserRole } from '@medsupply/shared-types';
import { User } from '../models/User';
import { assertPriceListAssignable } from '../services/priceListService';
import { containsFilter, escapeRegex } from '../services/requestSanitiser';
import { territoryPermits } from '../services/onBehalfRules';

/**
 * Turns the form's price-list field into what the document stores.
 *
 * An empty string is how a form says "no list", and it has to become `null`
 * rather than reaching Mongoose as `''` — which casts to an error the customer
 * would see as a failed save with no field to blame. A named list is checked
 * for being assignable here, because assigning an inactive one is a price that
 * silently does not apply.
 */
async function resolvePriceList<T extends { priceListId?: string }>(data: T) {
  if (data.priceListId === undefined) return data;
  if (data.priceListId === '') return { ...data, priceListId: null };
  await assertPriceListAssignable(data.priceListId);
  return data;
}

// ─── Create shop (Admin / Super Admin only) ─────────────────────────────────
export const createShop = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = CreateShopSchema.parse(req.body);

    // Duplicate check on phone or drug licence
    const duplicate = await Shop.findOne({
      $or: [
        { primaryPhone: data.primaryPhone },
        ...(data.drugLicenceNumber ? [{ drugLicenceNumber: data.drugLicenceNumber }] : []),
      ],
    });

    if (duplicate) {
      return res.status(400).json({
        error: {
          code: 'DUPLICATE',
          message: 'A shop with this phone or licence number already exists',
        },
      });
    }

    const shop = await Shop.create({
      ...(await resolvePriceList(data)),
      createdBy: req.user!._id,
    });
    res.status(201).json({ data: shop });
  } catch (error) {
    next(error);
  }
};

// ─── Get one shop ─────────────────────────────────────────────────────────────
export const getShop = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shop = await Shop.findById(req.params.id)
      .populate('ownerIds', 'firstName lastName email')
      .populate('managerId', 'firstName lastName email');

    if (!shop) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shop not found' } });
    }

    // Shop Owners may only see their own shop
    if (req.user!.role === UserRole.SHOP_OWNER) {
      const isOwner = shop.ownerIds.some(
        (o: { _id: { toString(): string } }) => o._id.toString() === req.user!._id.toString(),
      );
      if (!isOwner) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      }
    }

    /*
     * A rep may open the customers they may act for, and no others.
     *
     * The list is already filtered by exactly this rule, so without it here a
     * rep could read any shop in the country by pasting its id — the list would
     * be scoped and the detail behind it would not, which is the shape of
     * scoping that only looks like scoping.
     *
     * `territoryPermits` rather than a second copy of the filter, for the same
     * reason `listShops` mirrors it: the list, the detail and
     * `decideOnBehalf`'s refusal must agree about which customers are theirs.
     */
    if (
      req.user!.role === UserRole.SALES &&
      !territoryPermits(req.user!.territories, shop.territory)
    ) {
      return res.status(403).json({
        error: { code: 'SHOP_OUTSIDE_TERRITORY', message: 'That customer is not in your area' },
      });
    }

    res.json({ data: shop });
  } catch (error) {
    next(error);
  }
};

// ─── List / search shops ─────────────────────────────────────────────────────
export const listShops = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Shop Owners: return only their own shop
    if (req.user!.role === UserRole.SHOP_OWNER) {
      const shop = await Shop.findOne({ ownerIds: req.user!._id });
      return res.json({ data: shop ? [shop] : [] });
    }

    const query = req.query;
    // Every one of these was previously taken straight from the query string.
    // `status` and `territory` could arrive as operator objects, `search` was
    // interpolated into a pattern the caller therefore controlled, and `limit`
    // was unbounded, so a single request could ask for the whole collection.
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const filter: Record<string, unknown> = {};

    if (typeof query.status === 'string') filter.status = query.status;
    if (typeof query.territory === 'string') filter.territory = query.territory;
    if (typeof query.search === 'string' && query.search.trim()) {
      const term = containsFilter(query.search.trim());
      filter.$or = [{ name: term }, { primaryPhone: term }, { reference: term }];
    }

    /*
     * A rep sees the customers they may actually act for, and nobody else.
     *
     * This list is the order-entry customer picker. Without the same rule the
     * submission enforces, a rep is offered shops that `decideOnBehalf` will
     * refuse, and finds out only after typing the whole order — a picker that
     * offers a choice the server will reject is worse than no picker.
     *
     * The filter is built to mirror `territoryPermits` exactly rather than to
     * approximate it: empty territories means unrestricted (no clause added),
     * a named territory matches case-insensitively, and a shop with **no**
     * territory recorded is excluded — because a missing field matches no
     * regex, and "we do not know where this shop is" must not read as "anybody
     * may sell to it".
     */
    const territories = req.user!.territories ?? [];
    if (territories.length > 0) {
      filter.territory = {
        $in: territories.map((territory) => new RegExp(`^${escapeRegex(territory.trim())}$`, 'i')),
      };
    }

    const [shops, total] = await Promise.all([
      Shop.find(filter)
        .populate('ownerIds', 'firstName lastName email')
        .populate('managerId', 'firstName lastName')
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      Shop.countDocuments(filter),
    ]);

    res.json({
      data: shops,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

// ─── Update shop ─────────────────────────────────────────────────────────────
export const updateShop = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await resolvePriceList(UpdateShopSchema.parse(req.body));
    const shop = await Shop.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
    });

    if (!shop) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shop not found' } });
    }

    res.json({ data: shop });
  } catch (error) {
    next(error);
  }
};

// ─── Assign owner to shop ────────────────────────────────────────────────────
export const assignOwner = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);

    if (!user || user.role !== UserRole.SHOP_OWNER) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'User must exist and have SHOP_OWNER role' },
      });
    }

    const shop = await Shop.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { ownerIds: userId } },
      { new: true },
    );

    if (!shop) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shop not found' } });
    }

    res.json({ data: shop });
  } catch (error) {
    next(error);
  }
};

// ─── Assign manager ──────────────────────────────────────────────────────────
export const assignManager = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);

    if (!user || user.role !== UserRole.MANAGER) {
      return res
        .status(400)
        .json({ error: { code: 'BAD_REQUEST', message: 'User must exist and have MANAGER role' } });
    }

    const shop = await Shop.findByIdAndUpdate(req.params.id, { managerId: userId }, { new: true });
    if (!shop) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shop not found' } });
    }

    res.json({ data: shop });
  } catch (error) {
    next(error);
  }
};

// ─── Set shop status ─────────────────────────────────────────────────────────
export const setShopStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, reason } = req.body;

    if (!Object.values(ShopStatus).includes(status)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid status' } });
    }

    const update: any = { status };
    if (reason) update.orderBlockingReason = reason;

    const shop = await Shop.findByIdAndUpdate(req.params.id, update, { new: true });

    if (!shop) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shop not found' } });
    }

    res.json({ data: shop });
  } catch (error) {
    next(error);
  }
};
