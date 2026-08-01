import { NextFunction, Response } from 'express';
import { DeliveryStatus, UserRole, UserStatus } from '@medsupply/shared-types';
import {
  DeliveryAssignmentSchema,
  DeliveryCompletionSchema,
  DeliveryFailureSchema,
  DeliveryHandoverSchema,
  DeliverySimpleActionSchema,
} from '@medsupply/validation';
import { AuthRequest } from '../middlewares/auth';
import { Delivery } from '../models/Delivery';
import { ProofFile } from '../models/ProofFile';
import { Shop } from '../models/Shop';
import { User } from '../models/User';
import {
  acknowledgeHandover,
  assignDelivery,
  cancelDelivery,
  completeDelivery,
  confirmPickup,
  confirmReturned,
  failDelivery,
  handoverDelivery,
  markArrived,
  sendDeliveryOtp,
  startDelivery,
  startReturn,
} from '../services/deliveryService';
import { getInvoiceBalance } from '../services/ledgerService';

const actor = (req: AuthRequest) => ({ _id: req.user!._id, role: req.user!.role as UserRole });

async function permittedDelivery(req: AuthRequest, id: string) {
  const delivery = await Delivery.findById(id)
    .populate('orderId', 'reference status statusHistory')
    .populate('packageId', 'reference barcode packageCount handoverStatus')
    .populate('invoiceId', 'reference grandTotalMinor amountDueMinor')
    .populate('shopId', 'reference name primaryPhone')
    .populate('assignedTo', 'firstName lastName email');
  if (!delivery)
    throw Object.assign(new Error('Delivery not found'), { statusCode: 404, code: 'NOT_FOUND' });
  if (
    req.user!.role === UserRole.DELIVERY_PERSON &&
    String(delivery.assignedTo?._id ?? delivery.assignedTo) !== String(req.user!._id)
  )
    throw Object.assign(new Error('Access denied'), { statusCode: 403, code: 'FORBIDDEN' });
  if (
    req.user!.role === UserRole.SHOP_OWNER &&
    !(await Shop.exists({ _id: delivery.shopId, ownerIds: req.user!._id }))
  )
    throw Object.assign(new Error('Access denied'), { statusCode: 403, code: 'FORBIDDEN' });
  const serialized = delivery.toObject() as Record<string, unknown>;
  const populatedInvoice = serialized.invoiceId as
    { _id?: unknown; amountDueMinor?: number; currentAmountDueMinor?: number } | undefined;
  if (populatedInvoice?._id) {
    const live = await getInvoiceBalance(String(populatedInvoice._id));
    populatedInvoice.amountDueMinor = live.currentAmountDueMinor;
    populatedInvoice.currentAmountDueMinor = live.currentAmountDueMinor;
  }
  return serialized;
}

export async function listDeliveries(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.priority) filter.priority = String(req.query.priority);
    if (req.query.assignedTo) filter.assignedTo = String(req.query.assignedTo);
    if (req.user!.role === UserRole.DELIVERY_PERSON) filter.assignedTo = req.user!._id;
    if (req.user!.role === UserRole.SHOP_OWNER) {
      const shops = await Shop.find({ ownerIds: req.user!._id }).distinct('_id');
      filter.shopId = { $in: shops };
    }
    if (req.query.q) {
      const escaped = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.reference = { $regex: escaped, $options: 'i' };
    }
    const [data, total] = await Promise.all([
      Delivery.find(filter)
        .populate('orderId', 'reference status')
        .populate('packageId', 'reference barcode packageCount handoverStatus')
        .populate('invoiceId', 'reference grandTotalMinor amountDueMinor')
        .populate('shopId', 'reference name primaryPhone')
        .populate('assignedTo', 'firstName lastName email')
        .sort({ priority: -1, expectedDeliveryDate: 1, createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Delivery.countDocuments(filter),
    ]);
    res.json({ data, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    next(error);
  }
}

export async function getDelivery(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await permittedDelivery(req, String(req.params.id)) });
  } catch (error) {
    next(error);
  }
}

export async function getOrderDelivery(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const delivery = await Delivery.findOne({ orderId: req.params.orderId });
    if (!delivery)
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'Delivery not created yet' } });
    res.json({ data: await permittedDelivery(req, String(delivery._id)) });
  } catch (error) {
    next(error);
  }
}

export async function deliveryPersonnel(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const people = await User.find({ role: UserRole.DELIVERY_PERSON, status: UserStatus.ACTIVE })
      .select('firstName lastName email')
      .sort({ firstName: 1, lastName: 1 })
      .lean();
    const workload = await Delivery.aggregate<{ _id: unknown; active: number }>([
      {
        $match: {
          assignedTo: { $ne: null },
          status: {
            $in: [
              DeliveryStatus.ASSIGNED,
              DeliveryStatus.HANDED_OVER,
              DeliveryStatus.PICKED_UP,
              DeliveryStatus.OUT_FOR_DELIVERY,
              DeliveryStatus.ARRIVED,
            ],
          },
        },
      },
      { $group: { _id: '$assignedTo', active: { $sum: 1 } } },
    ]);
    const counts = new Map(workload.map((value) => [String(value._id), value.active]));
    res.json({
      data: people.map((person) => ({
        ...person,
        activeDeliveries: counts.get(String(person._id)) ?? 0,
      })),
    });
  } catch (error) {
    next(error);
  }
}

function response(
  res: Response,
  result: {
    delivery: unknown;
    payment?: { reference?: string; status?: string } | null;
    idempotentReplay: boolean;
  },
) {
  return res.json({
    data: result.delivery,
    meta: {
      idempotentReplay: result.idempotentReplay,
      payment: result.payment
        ? { reference: result.payment.reference, status: result.payment.status }
        : undefined,
    },
  });
}

export async function assign(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    response(
      res,
      await assignDelivery(
        String(req.params.id),
        DeliveryAssignmentSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function handover(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    response(
      res,
      await handoverDelivery(
        String(req.params.id),
        DeliveryHandoverSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function acknowledge(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    response(
      res,
      await acknowledgeHandover(
        String(req.params.id),
        DeliverySimpleActionSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function pickup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    response(
      res,
      await confirmPickup(
        String(req.params.id),
        DeliverySimpleActionSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function start(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    response(
      res,
      await startDelivery(
        String(req.params.id),
        DeliverySimpleActionSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function arrived(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    response(
      res,
      await markArrived(
        String(req.params.id),
        DeliverySimpleActionSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function sendOtp(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    response(
      res,
      await sendDeliveryOtp(
        String(req.params.id),
        DeliverySimpleActionSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function complete(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    response(
      res,
      await completeDelivery(
        String(req.params.id),
        DeliveryCompletionSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function failed(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    response(
      res,
      await failDelivery(String(req.params.id), DeliveryFailureSchema.parse(req.body), actor(req)),
    );
  } catch (error) {
    next(error);
  }
}
export async function returning(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    response(
      res,
      await startReturn(
        String(req.params.id),
        DeliverySimpleActionSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function returned(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    response(
      res,
      await confirmReturned(
        String(req.params.id),
        DeliverySimpleActionSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function cancel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    response(
      res,
      await cancelDelivery(
        String(req.params.id),
        DeliverySimpleActionSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function proofFile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const file = await ProofFile.findById(req.params.fileId).select('+data');
    if (!file)
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'Proof file not found' } });
    await permittedDelivery(req, String(file.deliveryId));
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.fileName.replace(/["\\]/g, '')}"`,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(file.data);
  } catch (error) {
    next(error);
  }
}
