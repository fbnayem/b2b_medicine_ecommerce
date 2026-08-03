import { NextFunction, Response } from 'express';
import { PaymentSource, UserRole } from '@medsupply/shared-types';
import {
  CreatePaymentSchema,
  PaymentFailSchema,
  PaymentHandoverSchema,
  PaymentPostSchema,
  PaymentReverseSchema,
} from '@medsupply/validation';
import { AuthRequest } from '../middlewares/auth';
import { Payment } from '../models/Payment';
import { PaymentAttachment } from '../models/PaymentAttachment';
import { Shop } from '../models/Shop';
import { getCollectorSummary } from '../services/financeService';
import {
  failPayment,
  getReceiptData,
  handoverCollection,
  postPayment,
  recordPayment,
  reversePayment,
} from '../services/paymentService';
import { formatDateTime, formatMoneyMinor } from '@medsupply/utilities';
import { createSimplePdf } from '../services/pdfService';
import { businessSettings } from '../services/settingsService';

const internalRoles: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
const actor = (req: AuthRequest) => ({ _id: req.user!._id, role: req.user!.role as UserRole });

type PaymentDtoSource = {
  toObject?: () => Record<string, unknown>;
  collectedAt?: unknown;
  postedAt?: unknown;
  attachmentId?: unknown;
};

function paymentDto(value: PaymentDtoSource) {
  const payment = value.toObject ? value.toObject() : (value as Record<string, unknown>);
  return {
    ...payment,
    collectionTime: value.collectedAt,
    postingTime: value.postedAt,
    attachmentFileId: value.attachmentId,
  };
}

function accessError() {
  return Object.assign(new Error('Access denied'), { statusCode: 403, code: 'FORBIDDEN' });
}

async function paymentFilter(req: AuthRequest) {
  const filter: Record<string, unknown> = {};
  if (req.user!.role === UserRole.SHOP_OWNER) {
    filter.shopId = { $in: await Shop.find({ ownerIds: req.user!._id }).distinct('_id') };
  } else if (req.user!.role === UserRole.DELIVERY_PERSON) {
    filter.collectedBy = req.user!._id;
    filter.source = PaymentSource.DELIVERY_COLLECTION;
  } else if (!internalRoles.includes(req.user!.role as UserRole)) {
    throw accessError();
  }
  return filter;
}

async function permittedPayment(req: AuthRequest, id: string) {
  const scope = await paymentFilter(req);
  const payment = await Payment.findOne({ _id: id, ...scope })
    .populate('shopId', 'reference name primaryPhone status')
    .populate('invoiceId', 'reference grandTotalMinor invoiceDate dueDate')
    .populate('deliveryId', 'reference status')
    .populate('collectedBy', 'firstName lastName email')
    .populate('receivedBy', 'firstName lastName email')
    .populate('postedBy', 'firstName lastName email')
    .populate('reversedBy', 'firstName lastName email');
  if (!payment)
    throw Object.assign(new Error('Payment not found'), { statusCode: 404, code: 'NOT_FOUND' });
  return payment;
}

export async function listPayments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const filter = await paymentFilter(req);
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.method) filter.method = String(req.query.method);
    if (req.query.source) filter.source = String(req.query.source);
    if (req.query.shopId && internalRoles.includes(req.user!.role as UserRole))
      filter.shopId = String(req.query.shopId);
    if (req.query.invoiceId) filter.invoiceId = String(req.query.invoiceId);
    if (req.query.deliveryId) filter.deliveryId = String(req.query.deliveryId);
    if (req.query.q) {
      const escaped = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.reference = { $regex: escaped, $options: 'i' };
    }
    if (req.query.from || req.query.to) {
      const value: Record<string, Date> = {};
      if (req.query.from) value.$gte = new Date(`${String(req.query.from)}T00:00:00+06:00`);
      if (req.query.to) value.$lte = new Date(`${String(req.query.to)}T23:59:59.999+06:00`);
      filter.collectedAt = value;
    }
    const [data, total] = await Promise.all([
      Payment.find(filter)
        .populate('shopId', 'reference name')
        .populate('invoiceId', 'reference grandTotalMinor')
        .populate('deliveryId', 'reference status')
        .populate('collectedBy', 'firstName lastName')
        .sort({ collectedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Payment.countDocuments(filter),
    ]);
    res.json({
      data: data.map((payment) => paymentDto(payment)),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
}

export async function createPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await recordPayment(CreatePaymentSchema.parse(req.body), actor(req));
    res.status(result.idempotentReplay ? 200 : 201).json({
      data: paymentDto(result.payment),
      meta: { idempotentReplay: result.idempotentReplay },
    });
  } catch (error) {
    next(error);
  }
}

export async function getPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: paymentDto(await permittedPayment(req, String(req.params.id))) });
  } catch (error) {
    next(error);
  }
}

export async function post(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await postPayment(
      String(req.params.id),
      PaymentPostSchema.parse(req.body),
      actor(req),
    );
    res.json({
      data: paymentDto(result.payment),
      meta: { idempotentReplay: result.idempotentReplay },
    });
  } catch (error) {
    next(error);
  }
}

export async function fail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await failPayment(
      String(req.params.id),
      PaymentFailSchema.parse(req.body),
      actor(req),
    );
    res.json({
      data: paymentDto(result.payment),
      meta: { idempotentReplay: result.idempotentReplay },
    });
  } catch (error) {
    next(error);
  }
}

export async function reverse(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await reversePayment(
      String(req.params.id),
      PaymentReverseSchema.parse(req.body),
      actor(req),
    );
    res.json({
      data: paymentDto(result.payment),
      meta: { idempotentReplay: result.idempotentReplay },
    });
  } catch (error) {
    next(error);
  }
}

export async function handover(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await handoverCollection(
      String(req.params.id),
      PaymentHandoverSchema.parse(req.body),
      actor(req),
    );
    res.json({
      data: paymentDto(result.payment),
      meta: { idempotentReplay: result.idempotentReplay },
    });
  } catch (error) {
    next(error);
  }
}

export async function myCollections(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({
      data: await getCollectorSummary(
        String(req.user!._id),
        Math.max(1, Number(req.query.page) || 1),
        Math.min(100, Math.max(1, Number(req.query.limit) || 30)),
      ),
    });
  } catch (error) {
    next(error);
  }
}

export async function receipt(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await permittedPayment(req, String(req.params.id));
    const data = await getReceiptData(String(req.params.id));
    if (req.query.format === 'pdf') {
      const shop = data.shop as unknown as { reference?: string; name?: string };
      const invoice = data.invoice as unknown as { reference?: string } | undefined;
      const business = await businessSettings();
      const pdf = await createSimplePdf([
        business.name,
        'PAYMENT RECEIPT',
        `Receipt: ${data.receiptReference ?? '-'}`,
        `Payment: ${data.paymentReference}`,
        `Shop: ${shop?.reference ?? ''} ${shop?.name ?? ''}`,
        `Invoice: ${invoice?.reference ?? 'Advance balance'}`,
        `Amount: ${formatMoneyMinor(data.amountMinor)}`,
        `Method: ${data.method.replaceAll('_', ' ')}`,
        `Transaction reference: ${data.transactionReference ?? '-'}`,
        `Collected: ${formatDateTime(data.collectedAt)}`,
        `Posted: ${data.postedAt ? formatDateTime(data.postedAt) : '-'}`,
        data.status === 'REVERSED' ? `REVERSED: ${data.reversalReference ?? ''}` : '',
        business.invoiceFooter,
      ]);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${String(data.receiptReference ?? data.paymentReference).replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`,
      );
      res.send(pdf);
      return;
    }
    res.json({ data });
  } catch (error) {
    next(error);
  }
}

export async function attachment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await permittedPayment(req, String(req.params.id));
    const file = await PaymentAttachment.findOne({ paymentId: req.params.id }).select('+data');
    if (!file)
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'Attachment not found' } });
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
