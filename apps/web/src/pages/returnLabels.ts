import { ReturnStatus } from '@medsupply/shared-types';

/**
 * Which statuses the returns filter offers, and in which order.
 *
 * The **words** are gone from here. This file used to carry its own status
 * labels, which made it a third wording of the same set — `StatusPill` said
 * "Received" where this said "Awaiting credit" for the identical status, and
 * the reasons list restated the nine `ReturnReason` members a second time. Both
 * now come from the translation catalogue, which is also the only way they can
 * ever be read in Bangla.
 *
 * What is genuinely local is the *order* a person scanning the filter expects:
 * the live states first, the finished ones last.
 */
export const RETURN_STATUS_FILTER_ORDER: readonly ReturnStatus[] = [
  ReturnStatus.REQUESTED,
  ReturnStatus.UNDER_REVIEW,
  ReturnStatus.APPROVED,
  ReturnStatus.PARTIALLY_APPROVED,
  ReturnStatus.COLLECTED,
  ReturnStatus.RECEIVED,
  ReturnStatus.COMPLETED,
  ReturnStatus.REJECTED,
  ReturnStatus.CANCELLED,
];
