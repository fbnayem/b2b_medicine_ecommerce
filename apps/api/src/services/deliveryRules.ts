import { DeliveryStatus, OrderStatus, UserRole } from '@medsupply/shared-types';

export type DeliveryTransitionPolicy = {
  action: string;
  from: DeliveryStatus[];
  to: DeliveryStatus;
  roles: UserRole[];
  requiredData: string[];
  sideEffects: string[];
  auditEvent: string;
  notificationEvent?: string;
  orderStatus?: OrderStatus;
};

export const deliveryTransitionPolicies: DeliveryTransitionPolicy[] = [
  {
    action: 'ASSIGN',
    from: [DeliveryStatus.READY_FOR_ASSIGNMENT, DeliveryStatus.ASSIGNED],
    to: DeliveryStatus.ASSIGNED,
    roles: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER],
    requiredData: ['deliveryPersonId', 'expectedDeliveryDate', 'priority'],
    sideEffects: ['update order status', 'notify delivery person'],
    auditEvent: 'DELIVERY_ASSIGNED',
    notificationEvent: 'DELIVERY_ASSIGNED',
    orderStatus: OrderStatus.DELIVERY_ASSIGNED,
  },
  {
    action: 'HANDOVER',
    from: [DeliveryStatus.ASSIGNED],
    to: DeliveryStatus.HANDED_OVER,
    roles: [UserRole.STOREKEEPER],
    requiredData: ['packageReference', 'invoiceReference', 'packageCount'],
    sideEffects: ['update package custody', 'update order status'],
    auditEvent: 'DELIVERY_HANDOVER_CONFIRMED',
    notificationEvent: 'DELIVERY_HANDED_OVER',
    orderStatus: OrderStatus.HANDED_TO_DELIVERY,
  },
  {
    action: 'PICKUP',
    from: [DeliveryStatus.HANDED_OVER],
    to: DeliveryStatus.PICKED_UP,
    roles: [UserRole.DELIVERY_PERSON],
    requiredData: ['handoverAcknowledgement'],
    sideEffects: ['update order status'],
    auditEvent: 'DELIVERY_PICKED_UP',
    orderStatus: OrderStatus.PICKED_UP,
  },
  {
    action: 'START',
    from: [DeliveryStatus.PICKED_UP],
    to: DeliveryStatus.OUT_FOR_DELIVERY,
    roles: [UserRole.DELIVERY_PERSON],
    requiredData: [],
    sideEffects: ['update order status'],
    auditEvent: 'DELIVERY_STARTED',
    orderStatus: OrderStatus.OUT_FOR_DELIVERY,
  },
  {
    action: 'ARRIVE',
    from: [DeliveryStatus.OUT_FOR_DELIVERY],
    to: DeliveryStatus.ARRIVED,
    roles: [UserRole.DELIVERY_PERSON],
    requiredData: [],
    sideEffects: [],
    auditEvent: 'DELIVERY_ARRIVED',
  },
  {
    action: 'COMPLETE',
    from: [DeliveryStatus.ARRIVED],
    to: DeliveryStatus.DELIVERED,
    roles: [UserRole.DELIVERY_PERSON],
    requiredData: ['receiverName', 'receiverPhone', 'configured proof', 'deliveredPackageCount'],
    sideEffects: ['store proof files', 'update order status', 'stage collection for posting'],
    auditEvent: 'DELIVERY_CONFIRMED',
    notificationEvent: 'DELIVERY_COMPLETED',
    orderStatus: OrderStatus.DELIVERED,
  },
  {
    action: 'FAIL',
    from: [
      DeliveryStatus.ASSIGNED,
      DeliveryStatus.HANDED_OVER,
      DeliveryStatus.PICKED_UP,
      DeliveryStatus.OUT_FOR_DELIVERY,
      DeliveryStatus.ARRIVED,
    ],
    to: DeliveryStatus.FAILED,
    roles: [UserRole.DELIVERY_PERSON],
    requiredData: ['reason', 'notes'],
    sideEffects: ['update order status'],
    auditEvent: 'DELIVERY_FAILED',
    notificationEvent: 'DELIVERY_FAILED',
    orderStatus: OrderStatus.DELIVERY_FAILED,
  },
  {
    action: 'RETURN',
    from: [DeliveryStatus.FAILED],
    to: DeliveryStatus.RETURNING,
    roles: [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.DELIVERY_PERSON],
    requiredData: [],
    sideEffects: ['update package custody'],
    auditEvent: 'DELIVERY_RETURN_STARTED',
  },
  {
    action: 'RECEIVE_RETURN',
    from: [DeliveryStatus.RETURNING],
    to: DeliveryStatus.RETURNED_TO_STORE,
    roles: [UserRole.STOREKEEPER],
    requiredData: ['physical package'],
    sideEffects: ['update package custody'],
    auditEvent: 'DELIVERY_RETURNED_TO_STORE',
  },
];

export function deliveryPolicy(action: string) {
  return deliveryTransitionPolicies.find((policy) => policy.action === action);
}

/** Why a transition was refused, so a caller can say something useful. */
export type DeliveryTransitionRefusal =
  | { allowed: false; reason: 'UNKNOWN_ACTION' }
  | { allowed: false; reason: 'WRONG_STATE'; from: DeliveryStatus[] }
  | { allowed: false; reason: 'WRONG_ROLE'; roles: UserRole[] };

export type DeliveryTransitionVerdict =
  | { allowed: true; to: DeliveryStatus; orderStatus?: OrderStatus; auditEvent: string }
  | DeliveryTransitionRefusal;

/**
 * Decides one delivery transition.
 *
 * The policy table above described the state machine but nothing executed it —
 * `deliveryService` re-states every `from` and `to` inline, so the table was
 * documentation that could disagree with the code without anything noticing,
 * and its test asserted only that the documentation had the right *shape*.
 * A rule you can run is a rule you can test with the states it actually
 * refuses, which is what `deliveryRules.test.ts` now does.
 */
export function evaluateDeliveryTransition(
  action: string,
  from: DeliveryStatus,
  role: UserRole,
): DeliveryTransitionVerdict {
  const policy = deliveryPolicy(action);
  if (!policy) return { allowed: false, reason: 'UNKNOWN_ACTION' };
  if (!policy.from.includes(from))
    return { allowed: false, reason: 'WRONG_STATE', from: policy.from };
  if (!policy.roles.includes(role))
    return { allowed: false, reason: 'WRONG_ROLE', roles: policy.roles };
  return {
    allowed: true,
    to: policy.to,
    orderStatus: policy.orderStatus,
    auditEvent: policy.auditEvent,
  };
}

/**
 * The endpoint each transition is reached through.
 *
 * Declared rather than derived because the paths and the action names differ
 * (`RECEIVE_RETURN` is served at `/returned`). `deliveryRules.test.ts` checks
 * this against the mounted router, so a renamed route or a policy for an action
 * no endpoint exposes fails the build instead of rotting quietly.
 */
export const DELIVERY_ACTION_ROUTES: Record<string, string> = {
  ASSIGN: 'post /api/v1/deliveries/:id/assign',
  HANDOVER: 'post /api/v1/deliveries/:id/handover',
  PICKUP: 'post /api/v1/deliveries/:id/pickup',
  START: 'post /api/v1/deliveries/:id/start',
  ARRIVE: 'post /api/v1/deliveries/:id/arrived',
  COMPLETE: 'post /api/v1/deliveries/:id/complete',
  FAIL: 'post /api/v1/deliveries/:id/fail',
  RETURN: 'post /api/v1/deliveries/:id/returning',
  RECEIVE_RETURN: 'post /api/v1/deliveries/:id/returned',
};
