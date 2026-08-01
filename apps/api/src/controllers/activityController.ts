import { NextFunction, Response } from 'express';
import { ActivityFeedQuerySchema, ActivityTimelineQuerySchema } from '@medsupply/validation';
import { UserRole } from '@medsupply/shared-types';
import { AuthRequest } from '../middlewares/auth';
import { activityFeed, entityTimeline } from '../services/activityService';

const viewer = (req: AuthRequest) => ({
  _id: req.user!._id,
  role: req.user!.role as UserRole,
});

export async function timeline(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = ActivityTimelineQuerySchema.parse(req.query);
    const result = await entityTimeline(viewer(req), query);
    res.json({
      data: result.items,
      meta: { total: result.total, page: result.page, limit: result.limit },
    });
  } catch (error) {
    next(error);
  }
}

export async function feed(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = ActivityFeedQuerySchema.parse(req.query);
    const result = await activityFeed(viewer(req), query);
    res.json({
      data: result.items,
      meta: { total: result.total, page: result.page, limit: result.limit },
    });
  } catch (error) {
    next(error);
  }
}
