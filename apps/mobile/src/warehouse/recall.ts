import type { ControlledRegister, RecallTrace } from '@medsupply/shared-types';
import { apiClient } from '../api/client';

/**
 * Finding a batch by the number printed on the carton, and the register an
 * inspector asks for.
 *
 * A recall is a person standing in front of shelves with a phone and a batch
 * number from a manufacturer's notice, asking two questions: **is any of it
 * still here**, and **who did we send it to**. Both were desktop-only.
 */

type Envelope<T> = { data: T };

export interface BatchMatch {
  _id: string;
  batchNumber: string;
  expiryDate: string;
  quantityOnHand: number;
  isBlocked?: boolean;
  isQuarantined?: boolean;
  medicineSnapshot?: { brandName?: string; strength?: string };
}

export async function findBatches(batchNumber: string) {
  const response = await apiClient.get<Envelope<BatchMatch[]>>('/purchasing/recall/batches', {
    params: { batchNumber },
  });
  return response.data.data;
}

export async function traceBatch(batchId: string) {
  const response = await apiClient.get<Envelope<RecallTrace>>(
    `/purchasing/recall/batches/${batchId}`,
  );
  return response.data.data;
}

export async function getControlledRegister(from: string, to: string) {
  const response = await apiClient.get<Envelope<ControlledRegister>>(
    '/purchasing/controlled-register',
    { params: { from, to } },
  );
  return response.data.data;
}

/** One batch, as the inventory screens hold it. */
export async function getBatch(batchId: string) {
  const response = await apiClient.get<Envelope<Record<string, unknown>>>(
    `/inventory/batches/${batchId}`,
  );
  return response.data.data;
}

export async function adjustBatch(
  batchId: string,
  body: { quantity: number; reason: string; notes?: string; idempotencyKey: string },
) {
  const response = await apiClient.post(`/inventory/batches/${batchId}/adjust`, body);
  return response.data.data;
}

export async function blockBatch(batchId: string, isBlocked: boolean, reason: string) {
  const response = await apiClient.patch(`/inventory/batches/${batchId}/block`, {
    isBlocked,
    reason,
  });
  return response.data.data;
}

/**
 * Whether a trace has anything that cannot be accounted for.
 *
 * `quantityUnaccounted` is received minus despatched minus what is still on the
 * shelf, and **anything other than zero is a question somebody has to answer**
 * during a recall — it is stock that left the building without an invoice
 * against it. Surfaced as its own state rather than as one figure among six,
 * because it is the one that changes what happens next.
 */
export function hasUnaccounted(trace: Pick<RecallTrace, 'totals'>): boolean {
  return trace.totals.quantityUnaccounted !== 0;
}

/**
 * Rows of the register that do not balance.
 *
 * Same reasoning, for the same reason: a register that only adds up its own
 * movements can never disagree with itself, and the variance column is the
 * whole control. A period with none is the ordinary case and gets a sentence;
 * a period with any needs them at the top.
 */
export function unbalanced(register: Pick<ControlledRegister, 'rows'>) {
  return register.rows.filter((row) => row.varianceQuantity !== 0);
}
