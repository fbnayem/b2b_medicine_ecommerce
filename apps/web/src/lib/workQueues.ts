import {
  APPROVAL_AWAITING,
  APPROVAL_DECIDED,
  PICKING_DONE,
  PICKING_OUTSTANDING,
} from '@medsupply/shared-types';

/**
 * What counts as work still outstanding, in one place.
 *
 * ## The defect this exists to stop
 *
 * The home screen said **"3 orders waiting for your decision"** when one was.
 * The other two had been decided — one approved, one rejected — days earlier.
 * It said **"15 orders to pick"** when one was; fourteen were already packed
 * and gone. Both numbers were the unfiltered length of an endpoint whose
 * default returns the whole history of a queue rather than its backlog.
 *
 * The tiles were not doing anything unreasonable. `homeSignals` says a signal
 * reuses the URL of the screen it links to, and claims of every one that "its
 * *unfiltered* length is itself the backlog". For deliveries and for packed
 * orders that is true — those endpoints filter server-side. For approvals and
 * picking it was simply false, and nothing checked it.
 *
 * So the split is written down here, both halves of it, and used by the tile
 * *and* by the screen it links to. They cannot disagree, because there is only
 * one string.
 *
 * ## Why both halves
 *
 * `outstanding` is what the number means. `settled` is everything else the
 * queue can hold. `workQueues.test.ts` asserts the two together cover every
 * status the endpoint can return — so a new status added to a queue fails a
 * test rather than quietly falling out of a count somebody trusts.
 */

export { APPROVAL_AWAITING, APPROVAL_DECIDED, PICKING_OUTSTANDING, PICKING_DONE };

export interface WorkQueue {
  /** The filter value meaning "everything still outstanding". */
  outstanding: string;
  /** Every value the filter offers, in the order the work is met. */
  filters: readonly string[];
  /** The request for a given filter value; empty means every status. */
  url: (status: string) => string;
}

export const approvalsQueue: WorkQueue = {
  outstanding: APPROVAL_AWAITING.join(','),
  filters: ['', APPROVAL_AWAITING.join(','), ...APPROVAL_AWAITING, ...APPROVAL_DECIDED],
  url: (status) => `/approvals/queue${status ? `?status=${status}` : ''}`,
};

export const pickingQueue: WorkQueue = {
  outstanding: PICKING_OUTSTANDING.join(','),
  filters: ['', PICKING_OUTSTANDING.join(','), ...PICKING_OUTSTANDING, ...PICKING_DONE],
  url: (status) => `/fulfilment/queue${status ? `?status=${status}` : ''}`,
};
