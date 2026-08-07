import type {
  AnalyticsOverview,
  ReturnReason,
  ReturnStatus,
  UserRole,
} from '@medsupply/shared-types';
import { apiClient } from '../api/client';

export interface ReturnLineView {
  medicineId: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  invoicedQuantity: number;
  requestedQuantity: number;
  approvedQuantity: number;
  receivedQuantity: number;
  restockQuantity: number;
  damagedQuantity: number;
  expiredQuantity: number;
  quarantinedQuantity: number;
  refundMinor: number;
  reason: ReturnReason;
  medicineSnapshot: { brandName: string; genericName: string; strength: string; packSize: string };
}

export interface ReturnSummary {
  _id: string;
  reference: string;
  status: ReturnStatus;
  primaryReason: ReturnReason;
  requestedAt: string;
  requestedTotalMinor: number;
  approvedTotalMinor: number;
  creditNoteReference?: string;
  shopId?: { _id: string; reference: string; name?: string } | string;
  invoiceId?: { _id: string; reference: string; name?: string } | string;
}

export interface ReturnDetailView extends ReturnSummary {
  /**
   * The issued credit note, once there is one.
   *
   * `creditNoteReference` above is the string printed on the return; **this**
   * carries the identifier the document itself is fetched by. The endpoint has
   * always sent it — this client simply never declared it, so the reference was
   * shown as text a pharmacy could read and not obtain.
   */
  creditNote?: { _id: string; reference: string; totalMinor: number; issuedAt: string };
  lines: ReturnLineView[];
  approvedSubtotalMinor: number;
  approvedTaxMinor: number;
  shopNotes?: string;
  reviewNotes?: string;
  rejectionReason?: string;
  reviewedAt?: string;
  collectedAt?: string;
  receivedAt?: string;
  completedAt?: string;
  version: number;
}

type Envelope<T> = { data: T; meta?: { page?: number; pages?: number; total?: number } };

export async function getReturns(params: Record<string, string | number> = {}) {
  const response = await apiClient.get<Envelope<ReturnSummary[]>>('/returns', { params });
  return {
    items: response.data.data,
    page: response.data.meta?.page ?? 1,
    pages: response.data.meta?.pages ?? 1,
  };
}

export async function getReturn(id: string) {
  const response = await apiClient.get<Envelope<ReturnDetailView>>(`/returns/${id}`);
  return response.data.data;
}

export type ReturnStep =
  'review' | 'decision' | 'reject' | 'cancel' | 'collect' | 'receive' | 'credit-note';

type Body = Record<string, unknown>;
type Acted = Promise<{ data: Envelope<ReturnDetailView> }>;

/**
 * Each step of a return, naming its own request.
 *
 * This was one call with the step interpolated — `` `/returns/${id}/${action}` ``
 * — and a path assembled from a variable is invisible to `callers.test.ts`,
 * which reads the method sitting immediately before a path *literal*. Seven
 * endpoints were exempt from the one gate that notices when a capability loses
 * its caller, and `POST /returns/{id}/collect` in particular: the only way a
 * rider takes back goods a shop is sending, on a screen that already filters a
 * rider's list down to exactly that queue.
 *
 * Same correction as `documents/files.ts`, `reports/api.ts` and
 * `delivery/actions.ts`.
 */
const STEP: Record<ReturnStep, (id: string, body: Body) => Acted> = {
  /** A manager takes the request off the queue and starts looking at it. */
  review: (id, body) => apiClient.post(`/returns/${id}/review`, body),
  /** How much of what was asked for is agreed, line by line. */
  decision: (id, body) => apiClient.post(`/returns/${id}/decision`, body),
  /** Or none of it, with the reason the shop will read. */
  reject: (id, body) => apiClient.post(`/returns/${id}/reject`, body),
  /** The shop changes its mind, or the office does. */
  cancel: (id, body) => apiClient.post(`/returns/${id}/cancel`, body),
  /** A rider picks the goods up from the shop. */
  collect: (id, body) => apiClient.post(`/returns/${id}/collect`, body),
  /** The warehouse books them back in and says what each is fit for. */
  receive: (id, body) => apiClient.post(`/returns/${id}/receive`, body),
  /** And the money goes back on the shop's account. */
  'credit-note': (id, body) => apiClient.post(`/returns/${id}/credit-note`, body),
};

export async function returnAction(id: string, action: ReturnStep, body: Body) {
  const response = await STEP[action](id, body);
  return response.data.data;
}

export async function getAnalyticsOverview(params: Record<string, string>) {
  const response = await apiClient.get<Envelope<AnalyticsOverview>>('/reports/overview', {
    params,
  });
  return response.data.data;
}

const MANAGEMENT: UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'] as UserRole[];

/**
 * Which return actions a role may start. The server enforces the same policy;
 * this only decides whether a button is worth showing.
 */
export function availableActions(role: UserRole | undefined, status: ReturnStatus): string[] {
  if (!role) return [];
  const management = MANAGEMENT.includes(role);
  const actions: string[] = [];
  if (management && (status === 'REQUESTED' || status === 'UNDER_REVIEW')) {
    actions.push('review', 'approve', 'reject');
  }
  if (
    (management || role === 'DELIVERY_PERSON') &&
    (status === 'APPROVED' || status === 'PARTIALLY_APPROVED')
  ) {
    actions.push('collect');
  }
  if (
    (management || role === 'STOREKEEPER') &&
    (status === 'APPROVED' || status === 'PARTIALLY_APPROVED' || status === 'COLLECTED')
  ) {
    actions.push('receive');
  }
  if (management && status === 'RECEIVED') actions.push('credit-note');
  if (
    (management || role === 'SHOP_OWNER') &&
    ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED'].includes(status)
  ) {
    actions.push('cancel');
  }
  return actions;
}

export interface DispositionDraft {
  restockQuantity: number;
  damagedQuantity: number;
  expiredQuantity: number;
  quarantinedQuantity: number;
}

/** What is wrong with a disposition, as a catalogue key rather than a sentence. */
export type DispositionProblem =
  | { key: 'returns.moreThanApproved'; values: { approved: number } }
  | { key: 'returns.expiredCannotRestock'; values?: undefined };

/**
 * Local guard mirroring the server rule, so a storekeeper standing at the
 * shelf sees the problem before a round trip rejects the whole receipt.
 *
 * It returned finished English — including "unit(s)", which is not a plural in
 * any language — so the one message a storekeeper reads while holding the
 * carton was the one part of the screen that could not be translated.
 */
export function dispositionProblem(
  line: { approvedQuantity: number; expiryDate: string },
  draft: DispositionDraft,
  now = new Date(),
): DispositionProblem | null {
  const total =
    draft.restockQuantity +
    draft.damagedQuantity +
    draft.expiredQuantity +
    draft.quarantinedQuantity;
  if (total > line.approvedQuantity) {
    return { key: 'returns.moreThanApproved', values: { approved: line.approvedQuantity } };
  }
  if (draft.restockQuantity > 0 && new Date(line.expiryDate) <= now) {
    return { key: 'returns.expiredCannotRestock' };
  }
  return null;
}
