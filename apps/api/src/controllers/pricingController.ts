import type { NextFunction, Response } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  CreatePriceListSchema,
  CreateSchemeSchema,
  UpdatePriceListSchema,
  UpdateSchemeSchema,
} from '@medsupply/validation';
import { z } from 'zod';
import type { AuthRequest } from '../middlewares/auth';
import {
  createPriceList,
  getPriceList,
  listPriceLists,
  updatePriceList,
} from '../services/priceListService';
import { createScheme, getScheme, listSchemes, updateScheme } from '../services/schemeService';
import { objectIdParam } from '../services/requestSanitiser';

/**
 * The commercial terms a distributor sets: what customers pay, and what they
 * get free for buying in quantity.
 */

function actor(req: AuthRequest) {
  return { _id: req.user!._id, role: req.user!.role as UserRole };
}

/**
 * The version the editor was holding when they pressed save.
 *
 * Sent in the body rather than an `If-Match` header because every other
 * optimistic update in this API does the same, and one convention beats a
 * cleverer second one.
 */
const VersionSchema = z.object({ version: z.number().int().min(0) });

function pagination(req: AuthRequest) {
  return {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 25,
    activeOnly: req.query.activeOnly === 'true',
  };
}

export async function getPriceLists(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await listPriceLists(pagination(req)) });
  } catch (error) {
    next(error);
  }
}

export async function getPriceListDetail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await getPriceList(String(req.params.id)) });
  } catch (error) {
    next(error);
  }
}

export async function postPriceList(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = CreatePriceListSchema.parse(req.body);
    res.status(201).json({ data: await createPriceList(input, actor(req)) });
  } catch (error) {
    next(error);
  }
}

export async function patchPriceList(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { version } = VersionSchema.parse(req.body);
    const input = UpdatePriceListSchema.parse(req.body);
    res.json({ data: await updatePriceList(String(req.params.id), version, input, actor(req)) });
  } catch (error) {
    next(error);
  }
}

export async function getSchemes(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    /*
     * The medicine filter belongs here and not in `pagination`, which price
     * lists also use: a price list carries many medicines, so `?medicineId=` on
     * that endpoint would either be ignored or mean something different. One
     * shared helper answering two different questions is how a filter comes to
     * be silently dropped.
     */
    const options = pagination(req);
    const asked = req.query.medicineId;
    if (asked === undefined) {
      res.json({ data: await listSchemes(options) });
      return;
    }

    const medicineId = objectIdParam(asked);
    /*
     * Asked for, and unusable.
     *
     * Dropping the filter here would answer a question about one medicine with
     * every offer in the tenant — the most misleading of the three possible
     * replies, and worse than the cast error that handing it straight to
     * Mongoose would raise. Nothing matches an id that cannot exist, so nothing
     * is what comes back.
     */
    if (!medicineId) {
      res.json({ data: { items: [], total: 0, page: options.page, limit: options.limit } });
      return;
    }

    res.json({ data: await listSchemes({ ...options, medicineId }) });
  } catch (error) {
    next(error);
  }
}

export async function getSchemeDetail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await getScheme(String(req.params.id)) });
  } catch (error) {
    next(error);
  }
}

export async function postScheme(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = CreateSchemeSchema.parse(req.body);
    res.status(201).json({ data: await createScheme(input, actor(req)) });
  } catch (error) {
    next(error);
  }
}

export async function patchScheme(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { version } = VersionSchema.parse(req.body);
    const input = UpdateSchemeSchema.parse(req.body);
    res.json({ data: await updateScheme(String(req.params.id), version, input, actor(req)) });
  } catch (error) {
    next(error);
  }
}
