import type { NextFunction, Response } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  AbandonStocktakeSchema,
  OpenStocktakeSchema,
  PostStocktakeSchema,
  RecordCountsSchema,
  SubmitStocktakeSchema,
} from '@medsupply/validation';
import type { AuthRequest } from '../middlewares/auth';
import { Stocktake, StocktakeStatus } from '../models/Stocktake';
import {
  abandonStocktake,
  openStocktake,
  postStocktake,
  recordCounts,
  submitForReview,
  varianceSummary,
} from '../services/stocktakeService';

function actor(req: AuthRequest) {
  return { _id: req.user!._id, role: req.user!.role as UserRole };
}

export async function listStocktakes(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = String(req.query.status);

    const [items, total] = await Promise.all([
      Stocktake.find(filter)
        .select(
          'reference status scope openedAt postedAt lines.systemQuantity lines.countedQuantity',
        )
        .sort({ openedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Stocktake.countDocuments(filter),
    ]);

    res.json({
      data: {
        items: items.map((stocktake) => ({
          ...stocktake,
          // The list shows progress, never the sheet itself: a counter must not
          // be able to read the expected figures off the index.
          lines: undefined,
          summary: varianceSummary(stocktake.lines ?? []),
        })),
        total,
        page,
        limit,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * One sheet.
 *
 * **`systemQuantity` is stripped while the count is open.** A blind count is
 * the whole point, and a screen that never asks for the figure is not a control
 * if the payload carries it anyway — anybody can read a network response. It
 * reappears the moment the sheet moves to review, which is when the variance is
 * supposed to become visible.
 */
export async function getStocktake(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const stocktake = await Stocktake.findById(req.params.id).lean();
    if (!stocktake) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Stocktake not found' } });
    }

    const blind = stocktake.status === StocktakeStatus.COUNTING;
    res.json({
      data: {
        ...stocktake,
        lines: stocktake.lines.map((line) => ({
          ...line,
          systemQuantity: blind ? undefined : line.systemQuantity,
        })),
        summary: blind ? undefined : varianceSummary(stocktake.lines),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function open(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = OpenStocktakeSchema.parse(req.body);
    res.status(201).json({ data: await openStocktake(input, actor(req)) });
  } catch (error) {
    next(error);
  }
}

export async function count(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = RecordCountsSchema.parse(req.body);
    const stocktake = await recordCounts(String(req.params.id), input, actor(req));
    // The response is the sheet the counter is already holding, still blind.
    res.json({
      data: {
        _id: stocktake._id,
        reference: stocktake.reference,
        status: stocktake.status,
        version: stocktake.version,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function submit(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = SubmitStocktakeSchema.parse(req.body);
    res.json({ data: await submitForReview(String(req.params.id), input.version) });
  } catch (error) {
    next(error);
  }
}

export async function post(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = PostStocktakeSchema.parse(req.body);
    res.json({ data: await postStocktake(String(req.params.id), input, actor(req)) });
  } catch (error) {
    next(error);
  }
}

export async function abandon(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = AbandonStocktakeSchema.parse(req.body);
    res.json({ data: await abandonStocktake(String(req.params.id), input, actor(req)) });
  } catch (error) {
    next(error);
  }
}
