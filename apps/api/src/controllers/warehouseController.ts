import type { NextFunction, Response } from 'express';
import { UserRole } from '@medsupply/shared-types';
import { CreateWarehouseSchema } from '@medsupply/validation';
import type { AuthRequest } from '../middlewares/auth';
import { createWarehouse, warehouseStock } from '../services/warehouseService';

function actor(req: AuthRequest) {
  return { _id: req.user!._id, role: req.user!.role as UserRole };
}

/** Every warehouse, with what it is holding. */
export async function listWarehouses(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const items = await warehouseStock();
    res.json({ data: { items, total: items.length, page: 1, limit: items.length } });
  } catch (error) {
    next(error);
  }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = CreateWarehouseSchema.parse(req.body);
    res.status(201).json({ data: await createWarehouse(input, actor(req)) });
  } catch (error) {
    next(error);
  }
}
