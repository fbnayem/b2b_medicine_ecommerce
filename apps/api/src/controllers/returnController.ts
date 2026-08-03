import { NextFunction, Response } from 'express';
import { UserRole } from '@medsupply/shared-types';
import {
  CreateReturnSchema,
  CreditNoteIssueSchema,
  ReturnCancelSchema,
  ReturnCollectionSchema,
  ReturnDecisionSchema,
  ReturnListQuerySchema,
  ReturnReceiptSchema,
  ReturnRejectionSchema,
  ReturnReviewStartSchema,
} from '@medsupply/validation';
import { AuthRequest } from '../middlewares/auth';
import {
  cancelReturn,
  collectReturn,
  createReturn,
  decideReturn,
  getCreditNote,
  getReturn,
  issueCreditNote,
  listReturns,
  receiveReturn,
  rejectReturn,
  startReturnReview,
  type ReturnActor,
} from '../services/returnService';
import { formatDate, formatMoneyMinor, formatQuantity } from '@medsupply/utilities';
import { createSimplePdf } from '../services/pdfService';
import { correlationId } from '../services/logger';

const actor = (req: AuthRequest): ReturnActor => ({
  _id: req.user!._id,
  role: req.user!.role as UserRole,
  firstName: req.user!.firstName,
  lastName: req.user!.lastName,
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
  correlationId: correlationId(),
});

/** Every lifecycle action answers 200 on an idempotent replay, 201 on create. */
function actionResponse(
  res: Response,
  result: { record: unknown; idempotentReplay: boolean },
  createdStatus = 200,
) {
  res
    .status(result.idempotentReplay ? 200 : createdStatus)
    .json({ data: result.record, meta: { idempotentReplay: result.idempotentReplay } });
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    actionResponse(res, await createReturn(CreateReturnSchema.parse(req.body), actor(req)), 201);
  } catch (error) {
    next(error);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await listReturns(actor(req), ReturnListQuerySchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
}

export async function detail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await getReturn(actor(req), String(req.params.id)) });
  } catch (error) {
    next(error);
  }
}

export async function startReview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    actionResponse(
      res,
      await startReturnReview(
        String(req.params.id),
        ReturnReviewStartSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function decide(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    actionResponse(
      res,
      await decideReturn(String(req.params.id), ReturnDecisionSchema.parse(req.body), actor(req)),
    );
  } catch (error) {
    next(error);
  }
}

export async function reject(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    actionResponse(
      res,
      await rejectReturn(String(req.params.id), ReturnRejectionSchema.parse(req.body), actor(req)),
    );
  } catch (error) {
    next(error);
  }
}

export async function cancel(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    actionResponse(
      res,
      await cancelReturn(String(req.params.id), ReturnCancelSchema.parse(req.body), actor(req)),
    );
  } catch (error) {
    next(error);
  }
}

export async function collect(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    actionResponse(
      res,
      await collectReturn(
        String(req.params.id),
        ReturnCollectionSchema.parse(req.body),
        actor(req),
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function receive(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    actionResponse(
      res,
      await receiveReturn(String(req.params.id), ReturnReceiptSchema.parse(req.body), actor(req)),
    );
  } catch (error) {
    next(error);
  }
}

export async function issueCredit(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await issueCreditNote(
      String(req.params.id),
      CreditNoteIssueSchema.parse(req.body),
      actor(req),
    );
    res.status(result.idempotentReplay ? 200 : 201).json({
      data: result.record,
      meta: { idempotentReplay: result.idempotentReplay, creditNote: result.creditNote },
    });
  } catch (error) {
    next(error);
  }
}

export async function creditNote(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const note = await getCreditNote(actor(req), String(req.params.id));
    if (req.query.format !== 'pdf') {
      res.json({ data: note });
      return;
    }
    const supplier = note.supplierSnapshot as Record<string, string>;
    const shop = note.shopSnapshot as Record<string, string>;
    const pdf = await createSimplePdf([
      supplier.name ?? 'Credit note',
      'CREDIT NOTE',
      `Reference: ${note.reference}`,
      `Against invoice: ${note.invoiceReference}`,
      `Return: ${note.returnReference}`,
      `Issued: ${formatDate(note.issuedAt)}`,
      `Customer: ${shop.reference ?? ''} ${shop.name ?? ''}`.trim(),
      '',
      ...note.lines.map(
        (line) =>
          `${formatQuantity(line.quantity)} x ${line.medicineSnapshot?.brandName ?? 'Item'} (batch ${line.batchNumber}) = ${formatMoneyMinor(line.lineTotalMinor)}`,
      ),
      '',
      `Subtotal: ${formatMoneyMinor(note.subtotalMinor)}`,
      `Tax: ${formatMoneyMinor(note.taxMinor)}`,
      `Total credited: ${formatMoneyMinor(note.totalMinor)}`,
    ]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${note.reference}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
}
