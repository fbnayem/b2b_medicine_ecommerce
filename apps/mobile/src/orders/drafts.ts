import { apiClient } from '../api/client';

/**
 * The order draft a basket is saved into, and taken out of again.
 *
 * A draft is the distributor's copy of a basket: it survives losing the phone,
 * and a sales representative can see it. That makes **discarding one a real
 * action rather than housekeeping** — a basket emptied on the device while the
 * draft stays on the server leaves an order nobody will ever submit sitting in
 * the distributor's system, and the next person to look at that customer sees a
 * pending order that no longer exists as far as the pharmacy is concerned.
 *
 * `DELETE /orders/drafts/{id}` has admitted a shop owner since the order-entry
 * phase and had no caller anywhere — not on this client, not on web.
 */
export interface DraftLine {
  medicineId: string;
  requestedQuantity: number;
}

/** Creates the draft on first save and amends it after that. Returns its id. */
export async function saveDraft(lines: DraftLine[], draftId?: string): Promise<string> {
  const body = { items: lines };
  const response = draftId
    ? await apiClient.patch(`/orders/drafts/${draftId}`, body)
    : await apiClient.post('/orders/drafts', body);
  return response.data.data._id;
}

/**
 * Discards the saved draft, if there is one.
 *
 * Tolerates a draft that has already gone — the customer's intent is that it
 * should not exist, and a 404 means it does not. Reporting that as a failure
 * would leave somebody pressing a button that is already done.
 */
export async function discardDraft(draftId: string | undefined): Promise<void> {
  if (!draftId) return;
  try {
    await apiClient.delete(`/orders/drafts/${draftId}`);
  } catch (caught) {
    const status = (caught as { response?: { status?: number } }).response?.status;
    if (status !== 404) throw caught;
  }
}
