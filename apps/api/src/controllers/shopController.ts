import mongoose from 'mongoose';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middlewares/auth';
import { Shop } from '../models/Shop';
import {
  CreateShopSchema,
  DeliveryAddressSchema,
  UpdateDeliveryAddressSchema,
  UpdateShopSchema,
} from '@medsupply/validation';
import { ShopStatus, UserRole } from '@medsupply/shared-types';
import { User } from '../models/User';
import { AuditLog } from '../models/AuditLog';
import { assertPriceListAssignable } from '../services/priceListService';
import { containsFilter, escapeRegex } from '../services/requestSanitiser';
import { territoryPermits } from '../services/onBehalfRules';
import { MAX_DELIVERY_ADDRESSES, soleDefaultIndex } from '../services/shopAddressRules';
import { correlationId } from '../services/logger';

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

    /*
     * The shops that registered themselves and have no terms yet.
     *
     * This is the half of self-registration that makes it safe. A shop can
     * create itself, and it starts with a credit limit of zero, no payment
     * terms, no discount and no price list — so it can trade prepaid and its
     * first credit order is refused at approval. That is a manager's decision
     * to make, and they can only make it if they can find the shop; without
     * this filter they meet it for the first time as an order in the approval
     * queue with a refusal attached.
     *
     * A **burn-down**, not a label: the moment somebody sets a credit limit or
     * payment terms the shop drops off this list. The list shrinking is the
     * work being done.
     */
    if (query.awaitingTerms === 'true') {
      filter.selfRegisteredAt = { $ne: null };
      filter.creditLimit = 0;
      filter.paymentTermsDays = 0;
    }
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

// ─── A shop's own delivery addresses ─────────────────────────────────────────

/**
 * Where a delivery goes, maintained by the people who actually know.
 *
 * Until now the only writer was `PATCH /shops/{id}`, which is administrators
 * only. So a pharmacy that opened a second branch, moved, or simply had a typo
 * in the street had to telephone the distributor and wait — and a
 * self-registered shop had **no** address at all, which is not a cosmetic gap:
 * `POST /orders/submit` requires `deliveryAddressId`, so a customer without one
 * cannot buy anything.
 *
 * These three routes are deliberately not `PATCH /shops/{id}` opened up. That
 * endpoint takes the whole shop — credit limit, payment terms, discount, price
 * list, status — and none of those are a customer's to set. The path says
 * `/my/addresses` because that is the entire extent of what it can change.
 */

/** The signed-in owner's shop, or `undefined`. */
async function ownShop(req: AuthRequest) {
  return Shop.findOne({ ownerIds: req.user!._id });
}

function noShop(res: Response) {
  return res.status(404).json({
    error: { code: 'NO_SHOP', message: 'No shop is linked to this account' },
  });
}

/**
 * The address list is the response to all three writes.
 *
 * A phone that has just added an address needs the ids of every address to
 * draw the list again, and the one it just created has an id only the server
 * knows. Returning the whole array means the screen never has to re-fetch, and
 * never renders a list that disagrees with what was stored.
 */
function addressList(shop: { deliveryAddresses: unknown }) {
  return { data: shop.deliveryAddresses };
}

async function auditAddress(
  req: AuthRequest,
  action: string,
  shopId: mongoose.Types.ObjectId,
  detail: { before?: unknown; after?: unknown },
) {
  await AuditLog.create({
    actorId: req.user!._id,
    actorRole: req.user!.role,
    action,
    entityType: 'Shop',
    entityId: shopId,
    before: detail.before,
    after: detail.after,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
    correlationId: correlationId(),
  });
}

type ShopDocument = NonNullable<Awaited<ReturnType<typeof ownShop>>>;

/**
 * Append one delivery address, whoever asked for it.
 *
 * Shared by the customer's own route and the staff one, because the rule is the
 * same either way: at most twenty, exactly one default, and an audit record
 * naming whoever did it. The **caller** differs — a shop owner may only reach
 * their own shop, staff name one — and that is settled before this is called.
 */
async function appendAddress(req: AuthRequest, res: Response, shop: ShopDocument) {
  const data = DeliveryAddressSchema.parse(req.body);

  if (shop.deliveryAddresses.length >= MAX_DELIVERY_ADDRESSES) {
    return res.status(400).json({
      error: {
        code: 'TOO_MANY_ADDRESSES',
        message: `A shop may keep at most ${MAX_DELIVERY_ADDRESSES} delivery addresses`,
      },
    });
  }

  shop.deliveryAddresses.push(data);
  const added = shop.deliveryAddresses[shop.deliveryAddresses.length - 1]!;
  /*
   * The first address a shop ever adds is its default whatever the form
   * said — `soleDefaultIndex` returns 0 for a single-element list — and a
   * later one only takes over if it was asked to.
   */
  const chosen = soleDefaultIndex(
    shop.deliveryAddresses,
    data.isDefault ? shop.deliveryAddresses.length - 1 : -1,
  );
  shop.deliveryAddresses.forEach((address, index) => {
    address.isDefault = index === chosen;
  });
  await shop.save();

  // Where medicines get delivered is a sensitive fact — it is the address a
  // controlled substance arrives at — so every change to it is recorded.
  await auditAddress(req, 'SHOP_ADDRESS_ADDED', shop._id, { after: added.toObject() });
  return res.status(201).json(addressList(shop));
}

export const addMyAddress = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shop = await ownShop(req);
    if (!shop) return noShop(res);
    return await appendAddress(req, res, shop);
  } catch (error) {
    next(error);
  }
};

/**
 * A delivery address added by staff, for a named customer.
 *
 * The order-entry screen has offered "add an address" since the order-entry
 * phase, and it wrote through `PATCH /shops/:id` — **which admits
 * administrators only**. A manager or a sales representative taking an order
 * for a customer whose address was not on file was shown the form, filled it
 * in, and got a 403. Nothing noticed because the browser test covering that
 * button signs in as an administrator.
 *
 * Deliberately a route of its own rather than widening that endpoint: `PATCH
 * /shops/:id` also carries the credit limit, the payment terms, the discount,
 * the price list and the status, and none of those are a sales representative's
 * to set. An address is not a commercial term — it is where the boxes go.
 */
export const addShopAddress = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shop = await Shop.findById(req.params.id);
    if (!shop) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shop not found' } });
    }

    /*
     * The same territory rule the list and the detail apply.
     *
     * Without it a rep could write a delivery address onto any customer in the
     * country by pasting an id — scoping on the read and none on the write,
     * which is the shape of scoping that only looks like scoping.
     */
    if (
      req.user!.role === UserRole.SALES &&
      !territoryPermits(req.user!.territories, shop.territory)
    ) {
      return res.status(403).json({
        error: { code: 'SHOP_OUTSIDE_TERRITORY', message: 'That customer is not in your area' },
      });
    }

    return await appendAddress(req, res, shop);
  } catch (error) {
    next(error);
  }
};

export const updateMyAddress = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = UpdateDeliveryAddressSchema.parse(req.body);
    const shop = await ownShop(req);
    if (!shop) return noShop(res);

    const index = shop.deliveryAddresses.findIndex(
      (address) => String(address._id) === req.params.addressId,
    );
    if (index < 0) {
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'No such delivery address' } });
    }

    const address = shop.deliveryAddresses[index]!;
    const before = address.toObject();
    for (const [field, value] of Object.entries(data)) {
      if (value !== undefined) (address as unknown as Record<string, unknown>)[field] = value;
    }

    // `isDefault: false` on the current default is not an instruction to leave
    // the shop without one; it is a request nobody can honour, so the rule
    // decides and the response says what actually happened.
    const chosen = soleDefaultIndex(shop.deliveryAddresses, data.isDefault ? index : -1);
    shop.deliveryAddresses.forEach((entry, position) => {
      entry.isDefault = position === chosen;
    });
    await shop.save();

    await auditAddress(req, 'SHOP_ADDRESS_UPDATED', shop._id, {
      before,
      after: shop.deliveryAddresses[index]!.toObject(),
    });
    res.json(addressList(shop));
  } catch (error) {
    next(error);
  }
};

export const removeMyAddress = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shop = await ownShop(req);
    if (!shop) return noShop(res);

    const index = shop.deliveryAddresses.findIndex(
      (address) => String(address._id) === req.params.addressId,
    );
    if (index < 0) {
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'No such delivery address' } });
    }

    /*
     * Removed, not refused, even when it is the last one.
     *
     * Orders already placed keep their own copy — `deliveryAddressSnapshot` is
     * written at submission — so deleting this record cannot change where an
     * order in flight is going. A shop left with none is told plainly at
     * checkout that it needs one, which is the same state a shop registered
     * five minutes ago is in.
     */
    const before = shop.deliveryAddresses[index]!.toObject();
    shop.deliveryAddresses.splice(index, 1);
    const chosen = soleDefaultIndex(shop.deliveryAddresses);
    shop.deliveryAddresses.forEach((entry, position) => {
      entry.isDefault = position === chosen;
    });
    await shop.save();

    await auditAddress(req, 'SHOP_ADDRESS_REMOVED', shop._id, { before });
    res.json(addressList(shop));
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
