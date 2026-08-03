import {
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
  ReturnStatus,
  ShopStatus,
  UserStatus,
} from '@medsupply/shared-types';
import { Badge, type BadgeTone } from './Data';

/**
 * One status, one colour, one wording, everywhere.
 *
 * Statuses were rendered by roughly forty ad-hoc `replaceAll('_', ' ')` calls,
 * which produced SHOUTING text — `READY FOR DELIVERY` — with the casing
 * differing between pages, and each page picked its own colour. The same order
 * could therefore be amber on one screen and grey on the next.
 *
 * The maps below are `Record<Status, …>`, so **adding a member to any status
 * enum in `@medsupply/shared-types` is a compile error here** until it has been
 * given a label and a tone. That turns "the new status renders as raw
 * `PARTIALLY_DELIVERED`" from something a user reports into something the build
 * refuses.
 */

type Tone = BadgeTone;

/**
 * Sentence case, and words rather than jargon: a shop owner does not know what
 * "FEFO" or "invoice generated" means, but does know "invoice ready".
 */
const ORDER: Record<OrderStatus, { label: string; tone: Tone }> = {
  [OrderStatus.DRAFT]: { label: 'Draft', tone: 'neutral' },
  [OrderStatus.SUBMITTED]: { label: 'Awaiting approval', tone: 'info' },
  [OrderStatus.UNDER_REVIEW]: { label: 'Being reviewed', tone: 'info' },
  [OrderStatus.ON_HOLD]: { label: 'On hold', tone: 'warning' },
  [OrderStatus.APPROVED]: { label: 'Approved', tone: 'success' },
  [OrderStatus.PARTIALLY_APPROVED]: { label: 'Partly approved', tone: 'warning' },
  [OrderStatus.REJECTED]: { label: 'Rejected', tone: 'danger' },
  [OrderStatus.PREPARING]: { label: 'Being picked', tone: 'info' },
  [OrderStatus.PACKING]: { label: 'Being packed', tone: 'info' },
  [OrderStatus.PACKED]: { label: 'Packed', tone: 'info' },
  [OrderStatus.INVOICE_GENERATED]: { label: 'Invoice ready', tone: 'info' },
  [OrderStatus.READY_FOR_DELIVERY]: { label: 'Ready for delivery', tone: 'info' },
  [OrderStatus.DELIVERY_ASSIGNED]: { label: 'Rider assigned', tone: 'info' },
  [OrderStatus.HANDED_TO_DELIVERY]: { label: 'With the rider', tone: 'info' },
  [OrderStatus.PICKED_UP]: { label: 'Collected from store', tone: 'info' },
  [OrderStatus.OUT_FOR_DELIVERY]: { label: 'On the way', tone: 'brand' },
  [OrderStatus.DELIVERED]: { label: 'Delivered', tone: 'success' },
  [OrderStatus.PARTIALLY_DELIVERED]: { label: 'Partly delivered', tone: 'warning' },
  [OrderStatus.DELIVERY_FAILED]: { label: 'Delivery failed', tone: 'danger' },
  [OrderStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
  [OrderStatus.RETURN_REQUESTED]: { label: 'Return requested', tone: 'warning' },
  [OrderStatus.RETURNED]: { label: 'Returned', tone: 'neutral' },
};

const DELIVERY: Record<DeliveryStatus, { label: string; tone: Tone }> = {
  [DeliveryStatus.READY_FOR_ASSIGNMENT]: { label: 'Needs a rider', tone: 'warning' },
  [DeliveryStatus.ASSIGNED]: { label: 'Rider assigned', tone: 'info' },
  [DeliveryStatus.HANDED_OVER]: { label: 'Handed to rider', tone: 'info' },
  [DeliveryStatus.PICKED_UP]: { label: 'Collected', tone: 'info' },
  [DeliveryStatus.OUT_FOR_DELIVERY]: { label: 'On the way', tone: 'brand' },
  [DeliveryStatus.ARRIVED]: { label: 'At the shop', tone: 'brand' },
  [DeliveryStatus.DELIVERED]: { label: 'Delivered', tone: 'success' },
  [DeliveryStatus.PARTIALLY_DELIVERED]: { label: 'Partly delivered', tone: 'warning' },
  [DeliveryStatus.FAILED]: { label: 'Failed', tone: 'danger' },
  [DeliveryStatus.RETURNING]: { label: 'Coming back', tone: 'warning' },
  [DeliveryStatus.RETURNED_TO_STORE]: { label: 'Back at the store', tone: 'neutral' },
  [DeliveryStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
};

const PAYMENT: Record<PaymentStatus, { label: string; tone: Tone }> = {
  [PaymentStatus.PENDING]: { label: 'Not yet posted', tone: 'warning' },
  [PaymentStatus.POSTED]: { label: 'Posted', tone: 'success' },
  [PaymentStatus.FAILED]: { label: 'Failed', tone: 'danger' },
  [PaymentStatus.REVERSED]: { label: 'Reversed', tone: 'danger' },
};

const RETURN: Record<ReturnStatus, { label: string; tone: Tone }> = {
  [ReturnStatus.REQUESTED]: { label: 'Requested', tone: 'info' },
  [ReturnStatus.UNDER_REVIEW]: { label: 'Being reviewed', tone: 'info' },
  [ReturnStatus.APPROVED]: { label: 'Approved', tone: 'success' },
  [ReturnStatus.PARTIALLY_APPROVED]: { label: 'Partly approved', tone: 'warning' },
  [ReturnStatus.REJECTED]: { label: 'Rejected', tone: 'danger' },
  [ReturnStatus.COLLECTED]: { label: 'Collected', tone: 'info' },
  [ReturnStatus.RECEIVED]: { label: 'Received', tone: 'info' },
  [ReturnStatus.COMPLETED]: { label: 'Completed', tone: 'success' },
  [ReturnStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
};

const SHOP: Record<ShopStatus, { label: string; tone: Tone }> = {
  [ShopStatus.PENDING]: { label: 'Awaiting approval', tone: 'warning' },
  [ShopStatus.ACTIVE]: { label: 'Active', tone: 'success' },
  [ShopStatus.INACTIVE]: { label: 'Inactive', tone: 'neutral' },
  [ShopStatus.SUSPENDED]: { label: 'Suspended', tone: 'danger' },
  [ShopStatus.CREDIT_BLOCKED]: { label: 'Credit blocked', tone: 'danger' },
  [ShopStatus.LICENCE_EXPIRED]: { label: 'Licence expired', tone: 'danger' },
};

const USER: Record<UserStatus, { label: string; tone: Tone }> = {
  [UserStatus.ACTIVE]: { label: 'Active', tone: 'success' },
  [UserStatus.INACTIVE]: { label: 'Inactive', tone: 'neutral' },
  [UserStatus.SUSPENDED]: { label: 'Suspended', tone: 'danger' },
};

const REGISTRY = {
  order: ORDER,
  delivery: DELIVERY,
  payment: PAYMENT,
  return: RETURN,
  shop: SHOP,
  user: USER,
} as const;

export type StatusKind = keyof typeof REGISTRY;

/**
 * The label alone, for places where a pill would be too heavy — a page title,
 * a CSV export, a sentence.
 */
export function statusLabel(kind: StatusKind, status: string): string {
  const entry = (REGISTRY[kind] as Record<string, { label: string }>)[status];
  // A status the maps have never heard of can only come from a server newer
  // than this bundle. Show it rather than an empty pill, but leave it visibly
  // raw so it reads as "unexpected" and not as a considered wording.
  return entry?.label ?? status.replaceAll('_', ' ').toLowerCase();
}

export interface StatusPillProps {
  kind: StatusKind;
  status: string;
  className?: string;
}

export function StatusPill({ kind, status, className }: StatusPillProps) {
  const entry = (REGISTRY[kind] as Record<string, { label: string; tone: Tone }>)[status];
  return (
    <Badge tone={entry?.tone ?? 'neutral'} className={className}>
      {statusLabel(kind, status)}
    </Badge>
  );
}
