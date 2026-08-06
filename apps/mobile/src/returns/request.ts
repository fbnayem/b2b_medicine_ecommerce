import type { ReturnReason } from '@medsupply/shared-types';
import { apiClient } from '../api/client';

/**
 * Raising a return from the phone.
 *
 * `POST /api/v1/returns` has admitted a shop owner since the returns phase and
 * **had no mobile caller at all**. A pharmacy that opened a carton and found it
 * damaged, short-dated or simply wrong had to find a computer — while standing
 * over the box, holding the invoice, with the batch number in front of them.
 * That is the moment the record is easiest to get right, and it was the one
 * moment the application could not be used.
 *
 * The rules here are the ones the server also enforces, mirrored so that a
 * mistake is caught before a round trip rather than after one:
 *
 *   - **Never more than was invoiced**, per invoice line. The ceiling is per
 *     *batch*, not per medicine: the same product on two batches is two
 *     independent limits, and the batch is what a credit note is raised
 *     against.
 *   - **Each invoice batch line at most once** — `CreateReturnSchema` refuses a
 *     duplicate because it would double-count that ceiling.
 *   - **At least one line with a quantity on it.** "Nothing selected" is not a
 *     failure of the request; it is a form that has not been filled in, and the
 *     two must not be reported with the same red box.
 */

export interface InvoiceOption {
  _id: string;
  reference: string;
  invoiceDate: string;
  grandTotalMinor: number;
}

export interface InvoiceLine {
  medicineId: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  lineTotalMinor: number;
  medicineSnapshot: { brandName: string; strength?: string; packSize?: string };
}

/** What has been typed against one invoice line. */
export interface LineDraft {
  quantity: string;
  reason: ReturnReason;
  notes: string;
}

export type ReturnDraft = Record<string, LineDraft>;

/**
 * The identity of an invoice line: medicine **and** batch.
 *
 * An invoice can carry the same medicine twice on two batches, so the medicine
 * id alone is not a key — using it would merge two rows with different expiry
 * dates into one, and the ceiling that is checked against would be the wrong
 * one.
 */
export const lineKey = (line: Pick<InvoiceLine, 'medicineId' | 'batchId'>): string =>
  `${line.medicineId}:${line.batchId}`;

export interface SelectedLine {
  line: InvoiceLine;
  entry: LineDraft;
  quantity: number;
}

/** The lines somebody has actually put a quantity against. */
export function selectedLines(lines: readonly InvoiceLine[], draft: ReturnDraft): SelectedLine[] {
  return lines
    .map((line) => ({
      line,
      entry: draft[lineKey(line)],
      quantity: Number(draft[lineKey(line)]?.quantity),
    }))
    .filter(
      (row): row is SelectedLine =>
        Boolean(row.entry) && Number.isFinite(row.quantity) && row.quantity > 0,
    );
}

/** What is wrong, as a catalogue key and the values its sentence needs. */
export type ReturnProblem =
  | { key: 'returns.needQuantity'; values?: undefined }
  | { key: 'returns.tooMany'; values: { maximum: number; brand: string } }
  | { key: 'returns.wholeUnitsOnly'; values: { brand: string } };

export function returnProblem(
  lines: readonly InvoiceLine[],
  draft: ReturnDraft,
): ReturnProblem | null {
  const selected = selectedLines(lines, draft);
  if (selected.length === 0) return { key: 'returns.needQuantity' };

  const fractional = selected.find((row) => !Number.isInteger(row.quantity));
  if (fractional) {
    // Boxes are not divisible, and `positiveQuantity` is an integer schema, so
    // this would be a 400 with the whole form rejected for one field.
    return {
      key: 'returns.wholeUnitsOnly',
      values: { brand: fractional.line.medicineSnapshot.brandName },
    };
  }

  const excessive = selected.find((row) => row.quantity > row.line.quantity);
  if (excessive) {
    return {
      key: 'returns.tooMany',
      values: {
        maximum: excessive.line.quantity,
        brand: excessive.line.medicineSnapshot.brandName,
      },
    };
  }
  return null;
}

/**
 * Roughly what a credit note would come to, pro-rated from the invoice.
 *
 * An **estimate**, and the screen says so. A manager decides what is actually
 * approved, line by line, and the credit note is raised from that decision —
 * so this figure is here to stop somebody raising a return for a hundred taka
 * of goods and expecting a thousand, not to promise a refund.
 *
 * The arithmetic is on `lineTotalMinor`, which the server computed and put on
 * the invoice. It is not a catalogue price, and it is not repriced here.
 */
export function estimateMinor(selected: readonly SelectedLine[]): number {
  return selected.reduce(
    (total, row) =>
      total + Math.round((row.line.lineTotalMinor * row.quantity) / row.line.quantity),
    0,
  );
}

/** A fresh draft with a row per invoice line, all empty. */
export function seedDraft(lines: readonly InvoiceLine[], reason: ReturnReason): ReturnDraft {
  return Object.fromEntries(
    lines.map((line) => [lineKey(line), { quantity: '', reason, notes: '' }]),
  );
}

type Envelope<T> = { data: T };

export async function getReturnableInvoices(): Promise<InvoiceOption[]> {
  const response = await apiClient.get<Envelope<InvoiceOption[] | { items: InvoiceOption[] }>>(
    '/finance/my/invoices',
    { params: { limit: 50 } },
  );
  const payload = response.data.data;
  return Array.isArray(payload) ? payload : payload.items;
}

export async function getInvoiceLines(invoiceId: string): Promise<InvoiceLine[]> {
  const response = await apiClient.get<Envelope<{ items?: InvoiceLine[] }>>(
    `/fulfilment/invoices/${invoiceId}`,
  );
  return response.data.data.items ?? [];
}

export async function requestReturn(input: {
  invoiceId: string;
  primaryReason: ReturnReason;
  shopNotes: string;
  selected: readonly SelectedLine[];
  idempotencyKey: string;
}): Promise<{ _id: string; reference: string }> {
  const response = await apiClient.post<Envelope<{ _id: string; reference: string }>>('/returns', {
    invoiceId: input.invoiceId,
    primaryReason: input.primaryReason,
    shopNotes: input.shopNotes.trim() || undefined,
    lines: input.selected.map((row) => ({
      medicineId: row.line.medicineId,
      batchId: row.line.batchId,
      quantity: row.quantity,
      reason: row.entry.reason,
      notes: row.entry.notes.trim() || undefined,
    })),
    idempotencyKey: input.idempotencyKey,
  });
  return response.data.data;
}
