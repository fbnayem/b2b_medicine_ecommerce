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

export async function returnAction(
  id: string,
  action: 'review' | 'decision' | 'reject' | 'cancel' | 'collect' | 'receive' | 'credit-note',
  body: Record<string, unknown>,
) {
  const response = await apiClient.post<Envelope<ReturnDetailView>>(
    `/returns/${id}/${action}`,
    body,
  );
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

export const RETURN_STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Requested',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Approved',
  PARTIALLY_APPROVED: 'Partly approved',
  REJECTED: 'Rejected',
  COLLECTED: 'Collected',
  RECEIVED: 'Awaiting credit',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function returnStatusLabel(status: string) {
  return RETURN_STATUS_LABELS[status] ?? status.replaceAll('_', ' ');
}

export interface DispositionDraft {
  restockQuantity: number;
  damagedQuantity: number;
  expiredQuantity: number;
  quarantinedQuantity: number;
}

/**
 * Local guard mirroring the server rule, so a storekeeper standing at the
 * shelf sees the problem before a round trip rejects the whole receipt.
 */
export function dispositionProblem(
  line: { approvedQuantity: number; expiryDate: string },
  draft: DispositionDraft,
  now = new Date(),
): string | null {
  const total =
    draft.restockQuantity +
    draft.damagedQuantity +
    draft.expiredQuantity +
    draft.quarantinedQuantity;
  if (total > line.approvedQuantity) {
    return `Only ${line.approvedQuantity} unit(s) were approved for return.`;
  }
  if (draft.restockQuantity > 0 && new Date(line.expiryDate) <= now) {
    return 'This batch has expired and cannot be restocked.';
  }
  return null;
}
