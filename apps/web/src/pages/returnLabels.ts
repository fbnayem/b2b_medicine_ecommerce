import { ReturnReason, ReturnStatus } from '@medsupply/shared-types';

/**
 * Shared return vocabulary. Kept out of the page components so the constants
 * can be imported without dragging a component module along with them.
 */
export const RETURN_STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: ReturnStatus.REQUESTED, label: 'Requested' },
  { value: ReturnStatus.UNDER_REVIEW, label: 'Under review' },
  { value: ReturnStatus.APPROVED, label: 'Approved' },
  { value: ReturnStatus.PARTIALLY_APPROVED, label: 'Partly approved' },
  { value: ReturnStatus.COLLECTED, label: 'Collected' },
  { value: ReturnStatus.RECEIVED, label: 'Awaiting credit' },
  { value: ReturnStatus.COMPLETED, label: 'Completed' },
  { value: ReturnStatus.REJECTED, label: 'Rejected' },
  { value: ReturnStatus.CANCELLED, label: 'Cancelled' },
];

export function statusLabel(status: string) {
  return (
    RETURN_STATUS_FILTERS.find((entry) => entry.value === status)?.label ??
    status.replaceAll('_', ' ')
  );
}

export const RETURN_REASONS: Array<{ value: ReturnReason; label: string }> = [
  { value: ReturnReason.DAMAGED_IN_TRANSIT, label: 'Damaged in transit' },
  { value: ReturnReason.EXPIRED, label: 'Expired' },
  { value: ReturnReason.NEAR_EXPIRY, label: 'Too close to expiry' },
  { value: ReturnReason.WRONG_ITEM, label: 'Wrong item supplied' },
  { value: ReturnReason.EXCESS_QUANTITY, label: 'Excess quantity' },
  { value: ReturnReason.QUALITY_COMPLAINT, label: 'Quality complaint' },
  { value: ReturnReason.COLD_CHAIN_BREACH, label: 'Cold chain breach' },
  { value: ReturnReason.ORDER_ERROR, label: 'Ordering error' },
  { value: ReturnReason.OTHER, label: 'Other' },
];
