# Order State Machine

Phase 4 owns `DRAFT -> SUBMITTED`. Only drafts are directly editable or deletable by Shop Owners. Cart and draft activity has no inventory side effect. Cancellation is recorded as a request while status is `SUBMITTED`, `UNDER_REVIEW`, or `ON_HOLD`; Phase 5 owns the manager decision and controlled transition to `CANCELLED`.

Phase 5 owns `SUBMITTED -> UNDER_REVIEW`, `SUBMITTED|UNDER_REVIEW|ON_HOLD -> ON_HOLD|REJECTED|APPROVED|PARTIALLY_APPROVED`. Approval transitions require an exact order version and atomically reserve FEFO stock, create OrderApproval/PickingList records and append history. Any failure rolls back every side effect.

Phase 6 owns `APPROVED|PARTIALLY_APPROVED -> PREPARING -> PACKING -> PACKED -> INVOICE_GENERATED`. Starting a PickingList moves every approved allocation from reserved to picking. Completing batch confirmation moves the order to `PACKING`. Packing confirmation moves actual units to packed, releases the unused allocation, creates the invoice/package, and records `PACKED` then `INVOICE_GENERATED` history in one transaction. Picking pause and discrepancy block are PickingList workflow states and do not let clients mutate Order status directly.

### PickingList transitions

- `PENDING -> PICKING`: Storekeeper starts; exact version and valid, unexpired, unblocked allocated batches required.
- `PICKING -> PICKING`: Storekeeper saves batch and quantity confirmation.
- `PICKING -> PAUSED -> PICKING`: Storekeeper pause/resume.
- `PICKING -> BLOCKED_DISCREPANCY`: Storekeeper report; management is notified.
- `BLOCKED_DISCREPANCY -> PICKING`: Manager/Admin resolves with notes.
- `PICKING -> PACKING`: Storekeeper completes batch confirmation.
- `PACKING -> PACKED`: Storekeeper packs; at least one unit and a reason for each reduction are required.

## Statuses

- DRAFT
- SUBMITTED
- UNDER_REVIEW
- ON_HOLD
- APPROVED
- PARTIALLY_APPROVED
- REJECTED
- PREPARING
- PACKING
- PACKED
- INVOICE_GENERATED
- READY_FOR_DELIVERY
- DELIVERY_ASSIGNED
- HANDED_TO_DELIVERY
- PICKED_UP
- OUT_FOR_DELIVERY
- DELIVERED
- PARTIALLY_DELIVERED
- DELIVERY_FAILED
- CANCELLED
- RETURN_REQUESTED
- RETURNED

## Key Transitions

- `DRAFT` -> `SUBMITTED` (Action by Shop Owner)
- `SUBMITTED` -> `UNDER_REVIEW` (Action by Manager)
- `UNDER_REVIEW` -> `APPROVED` | `REJECTED` | `ON_HOLD` (Action by Manager)
- `APPROVED` -> `PREPARING` (Action by Storekeeper)
- `PREPARING` -> `PACKING` -> `PACKED` (Action by Storekeeper)
- `PACKED` -> `INVOICE_GENERATED` (System Action)
- `INVOICE_GENERATED` -> `READY_FOR_DELIVERY` (System Action)
- `READY_FOR_DELIVERY` -> `DELIVERY_ASSIGNED` (Action by Manager)
- `DELIVERY_ASSIGNED` -> `HANDED_TO_DELIVERY` (Action by Storekeeper)
- `HANDED_TO_DELIVERY` -> `PICKED_UP` -> `OUT_FOR_DELIVERY` (Action by assigned Delivery Person)
- `OUT_FOR_DELIVERY` -> `DELIVERED` | `PARTIALLY_DELIVERED` | `DELIVERY_FAILED` (Action by assigned Delivery Person)

### Phase 7 Delivery transitions

- `READY_FOR_ASSIGNMENT -> ASSIGNED`: Manager/Admin selects an active Delivery Person, date, priority and instructions. Reassignment is allowed before handover.
- `ASSIGNED -> HANDED_OVER`: Storekeeper must match package reference, invoice reference and package count. The Order becomes `HANDED_TO_DELIVERY`.
- `HANDED_OVER -> HANDED_OVER`: the assigned Delivery Person acknowledges physical receipt; pickup is blocked until acknowledgement.
- `HANDED_OVER -> PICKED_UP -> OUT_FOR_DELIVERY -> ARRIVED`: only the assigned Delivery Person can advance these actions.
- `ARRIVED -> DELIVERED|PARTIALLY_DELIVERED`: receiver details, exact package count and all configured proofs are required. The corresponding Order terminal status is written in the same transaction.
- `ASSIGNED|HANDED_OVER|PICKED_UP|OUT_FOR_DELIVERY|ARRIVED -> FAILED`: requires an enumerated reason and notes; the Order becomes `DELIVERY_FAILED`.
- `FAILED -> RETURNING -> RETURNED_TO_STORE`: Delivery Person/management starts the return and a Storekeeper confirms physical store custody.
- `RETURNED_TO_STORE -> ASSIGNED`: a Manager may safely reassign the returned package for another attempt; package custody resets to awaiting handover and the Order returns to `DELIVERY_ASSIGNED`.

The complete transition policy, including role, required data, side effects, audit and notification events, is executable metadata in `apps/api/src/services/deliveryRules.ts`. All critical actions use optimistic versions and idempotency keys.

## Phase 8 financial side effects

`PACKING -> PACKED -> INVOICE_GENERATED -> READY_FOR_DELIVERY` now appends the Invoice charge journal and consumes/releases any credit reservation inside the packing transaction. Delivery completion may create a pending Payment but does not change customer due until the Payment posting action succeeds. Payment failure/reversal never directly rewrites Order status; their append-only finance actions recalculate due and emit audit/notification events.

## Phase 11 return transitions

A delivered order re-enters the flow when a customer returns goods.

- `DELIVERED|PARTIALLY_DELIVERED -> RETURN_REQUESTED`: a Shop Owner or management raises a return against the issued invoice. The status the request interrupted is recorded on the return so it can be restored.
- `RETURN_REQUESTED -> DELIVERED|PARTIALLY_DELIVERED`: the last open return against the order is rejected or cancelled, so the order goes back where it was. With several returns outstanding, only the last one to close releases the order.
- `RETURN_REQUESTED -> RETURNED`: a credit note is issued for a return in which every invoiced unit came back. A partial return credits the customer and leaves the order delivered, because the customer still keeps part of it.

The return's own lifecycle is `REQUESTED -> UNDER_REVIEW -> APPROVED|PARTIALLY_APPROVED|REJECTED -> COLLECTED -> RECEIVED -> COMPLETED`, with `CANCELLED` available until the goods are collected. Approval decides the value, receipt decides the stock and recalculates the value from what actually arrived, and only the credit note moves money. The complete policy — action, permitted source statuses, roles, required data, side effects and audit event — is executable metadata in `apps/api/src/services/returnRules.ts`, and every action uses an optimistic version and an idempotency key.
