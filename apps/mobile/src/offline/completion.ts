import { DeliveryProofType } from '@medsupply/shared-types';

/**
 * Whether a delivery can be finished with no signal, and what to say when it
 * cannot.
 *
 * ## The defect this exists for
 *
 * The offline queue held `acknowledge`, `pickup`, `start`, `arrived`, `fail` and
 * `returning` — every cheap status tap — and refused `complete`, which is the
 * one that ends the stop, carries the photograph and the signature, and may
 * carry cash. A rider at a shop door with no bars was told to keep the screen
 * open and try again.
 *
 * That is exactly backwards. The actions that cost nothing to repeat were
 * resilient, and the one a person is standing there waiting for was not.
 *
 * ## The one thing that genuinely cannot be queued
 *
 * A six-digit code sent to the customer's phone and checked against a hash on
 * the server. There is no offline answer to it — the code does not exist on the
 * handset, and a completion queued without it would be refused on flush, hours
 * later, with the rider long gone from the shop. So the screen says so at the
 * door, while it can still be acted on.
 *
 * Everything else survives: a signature is drawn on the glass, a photograph is
 * taken by the camera, and **GPS is not network** — the satellites do not care
 * whether there is a cell tower, so location proof stays honest offline.
 *
 * Kept out of the screen so the rule can be read and tested without a renderer.
 */

export type OfflineRefusal = 'delivery.otpNeedsSignal';

export function completionRefusal(
  proofRequirements: readonly DeliveryProofType[],
): OfflineRefusal | null {
  return proofRequirements.includes(DeliveryProofType.OTP) ? 'delivery.otpNeedsSignal' : null;
}

export function canCompleteOffline(proofRequirements: readonly DeliveryProofType[]): boolean {
  return completionRefusal(proofRequirements) === null;
}
