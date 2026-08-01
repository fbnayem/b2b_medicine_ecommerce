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
