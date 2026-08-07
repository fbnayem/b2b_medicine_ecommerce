import { apiClient } from '../api/client';

/**
 * Every step of a delivery, each naming its own request.
 *
 * ## Why this is not one function with a parameter
 *
 * It was. `delivery-detail.tsx` wrote `` apiClient.post(`/deliveries/${id}/${path}`) `` and
 * passed the step in as a string, and `offlineQueue.ts` did the same when it
 * flushed. That is nine endpoints — every transition a rider makes between being
 * handed a package and getting back to the warehouse — assembled from a
 * variable, and **a path built from a variable is invisible to `callers.test.ts`**,
 * which reads the method sitting immediately before a path *literal*.
 *
 * So the gate that exists to notice when a capability loses its caller could see
 * none of a rider's work. Deleting the "Mark arrived" button, or the
 * acknowledgement a storekeeper's handover waits on, failed nothing anywhere in
 * the repository.
 *
 * This is the third time the same shape has been corrected: `documents/files.ts`
 * and `reports/api.ts` were untangled in Phase 39 for exactly this reason, and
 * the rider's two busiest screens were left alone.
 *
 * ## The shape
 *
 * A record rather than nine exported functions, because the screen and the queue
 * both dispatch on a step they are holding as a value — the screen from a button,
 * the queue from something it wrote to disk an hour ago. The literals are what
 * matter, and each of them is here.
 */

export type DeliveryStep =
  | 'acknowledge'
  | 'pickup'
  | 'start'
  | 'arrived'
  | 'send-otp'
  | 'fail'
  | 'returning'
  | 'handover'
  | 'returned';

type Body = Record<string, unknown>;

const SEND: Record<DeliveryStep, (id: string, body: Body) => Promise<unknown>> = {
  /** A rider confirms they have the packages the storekeeper handed over. */
  acknowledge: (id, body) => apiClient.post(`/deliveries/${id}/acknowledge`, body),
  /** And that they have physically taken them out of the building. */
  pickup: (id, body) => apiClient.post(`/deliveries/${id}/pickup`, body),
  /** On the road. The shop can watch this happen. */
  start: (id, body) => apiClient.post(`/deliveries/${id}/start`, body),
  /** At the door, which is what turns the proof screen on. */
  arrived: (id, body) => apiClient.post(`/deliveries/${id}/arrived`, body),
  /** Send the customer the six digits that prove the right person signed. */
  'send-otp': (id, body) => apiClient.post(`/deliveries/${id}/send-otp`, body),
  /** Nobody in, shop shut, refused: a reason and a note, on the record. */
  fail: (id, body) => apiClient.post(`/deliveries/${id}/fail`, body),
  /** Carrying it back, so the warehouse knows to expect it. */
  returning: (id, body) => apiClient.post(`/deliveries/${id}/returning`, body),
  /** A storekeeper hands the packages over and names what is in them. */
  handover: (id, body) => apiClient.post(`/deliveries/${id}/handover`, body),
  /** And takes them back in when a delivery did not happen. */
  returned: (id, body) => apiClient.post(`/deliveries/${id}/returned`, body),
};

export function sendDeliveryStep(step: DeliveryStep, id: string, body: Body = {}) {
  return SEND[step](id, body);
}

/** Whether a string off the queue is still a step this client knows. */
export function isDeliveryStep(value: string): value is DeliveryStep {
  return value in SEND;
}
