import {
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
  ReturnStatus,
  ShopStatus,
  UserStatus,
} from '@medsupply/shared-types';
import { Badge, type BadgeTone } from './Data';
import { useLanguage } from '../../lib/useLanguage';

/**
 * One status, one colour, one wording, everywhere.
 *
 * Statuses were rendered by roughly forty ad-hoc `replaceAll('_', ' ')` calls,
 * which produced SHOUTING text — `READY FOR DELIVERY` — with the casing
 * differing between pages, and each page picked its own colour. The same order
 * could therefore be amber on one screen and grey on the next.
 *
 * **The words come from the catalogue; only the colour lives here.** They used
 * to live here too, in a second hard-coded English copy, while
 * `packages/i18n` already carried translated `orderStatus`, `deliveryStatus`,
 * `paymentStatus`, `returnStatus` and `shopStatus` namespaces that the filter
 * dropdowns read. So in Bangla the filter said one word and the pill beside the
 * row said another — two sources of truth for one string, agreeing only in
 * English. A colour is not translatable and a word is, which is the line the
 * split follows.
 *
 * The maps below are still `Record<Status, BadgeTone>`, so **adding a member to
 * any status enum in `@medsupply/shared-types` is a compile error here** until
 * it has been given a tone — and a compile error in the catalogue until it has
 * been given words in both languages. That turns "the new status renders as raw
 * `PARTIALLY_DELIVERED`" from something a user reports into something the build
 * refuses.
 */

/**
 * The lifecycle, read as phases rather than as twenty-two separate words.
 *
 * Ten of these were `info`, which meant a manager scanning the order list could
 * not tell "submitted" from "packed" from "picked up" without reading each pill
 * — so the colour carried no information and the list had to be read line by
 * line. The phases below are the ones a person actually distinguishes:
 *
 *   neutral   nothing is happening yet, or it is over without an outcome
 *   info      somebody has to decide
 *   warning   somebody has to decide and it is not going smoothly
 *   success   a decision went the right way
 *   danger    a decision went the wrong way
 *   progress  being worked on inside the building
 *   transit   has left the building
 *   brand     with the customer right now — the one moment worth spotting
 */
const ORDER: Record<OrderStatus, BadgeTone> = {
  [OrderStatus.DRAFT]: 'neutral',
  [OrderStatus.SUBMITTED]: 'info',
  [OrderStatus.UNDER_REVIEW]: 'info',
  [OrderStatus.ON_HOLD]: 'warning',
  [OrderStatus.APPROVED]: 'success',
  [OrderStatus.PARTIALLY_APPROVED]: 'warning',
  [OrderStatus.REJECTED]: 'danger',
  [OrderStatus.PREPARING]: 'progress',
  [OrderStatus.PACKING]: 'progress',
  [OrderStatus.PACKED]: 'progress',
  [OrderStatus.INVOICE_GENERATED]: 'progress',
  [OrderStatus.READY_FOR_DELIVERY]: 'transit',
  [OrderStatus.DELIVERY_ASSIGNED]: 'transit',
  [OrderStatus.HANDED_TO_DELIVERY]: 'transit',
  [OrderStatus.PICKED_UP]: 'transit',
  [OrderStatus.OUT_FOR_DELIVERY]: 'brand',
  [OrderStatus.DELIVERED]: 'success',
  [OrderStatus.PARTIALLY_DELIVERED]: 'warning',
  [OrderStatus.DELIVERY_FAILED]: 'danger',
  [OrderStatus.CANCELLED]: 'neutral',
  [OrderStatus.RETURN_REQUESTED]: 'warning',
  [OrderStatus.RETURNED]: 'neutral',
};

const DELIVERY: Record<DeliveryStatus, BadgeTone> = {
  [DeliveryStatus.READY_FOR_ASSIGNMENT]: 'warning',
  [DeliveryStatus.ASSIGNED]: 'transit',
  [DeliveryStatus.HANDED_OVER]: 'transit',
  [DeliveryStatus.PICKED_UP]: 'transit',
  [DeliveryStatus.OUT_FOR_DELIVERY]: 'brand',
  [DeliveryStatus.ARRIVED]: 'brand',
  [DeliveryStatus.DELIVERED]: 'success',
  [DeliveryStatus.PARTIALLY_DELIVERED]: 'warning',
  [DeliveryStatus.FAILED]: 'danger',
  [DeliveryStatus.RETURNING]: 'warning',
  [DeliveryStatus.RETURNED_TO_STORE]: 'neutral',
  [DeliveryStatus.CANCELLED]: 'neutral',
};

const PAYMENT: Record<PaymentStatus, BadgeTone> = {
  [PaymentStatus.PENDING]: 'warning',
  [PaymentStatus.POSTED]: 'success',
  [PaymentStatus.FAILED]: 'danger',
  [PaymentStatus.REVERSED]: 'danger',
};

const RETURN: Record<ReturnStatus, BadgeTone> = {
  [ReturnStatus.REQUESTED]: 'info',
  [ReturnStatus.UNDER_REVIEW]: 'info',
  [ReturnStatus.APPROVED]: 'success',
  [ReturnStatus.PARTIALLY_APPROVED]: 'warning',
  [ReturnStatus.REJECTED]: 'danger',
  // A return travels the same two phases as an order, in reverse: collected is
  // on the road, received is being worked on in the building.
  [ReturnStatus.COLLECTED]: 'transit',
  [ReturnStatus.RECEIVED]: 'progress',
  [ReturnStatus.COMPLETED]: 'success',
  [ReturnStatus.CANCELLED]: 'neutral',
};

const SHOP: Record<ShopStatus, BadgeTone> = {
  [ShopStatus.PENDING]: 'warning',
  [ShopStatus.ACTIVE]: 'success',
  [ShopStatus.INACTIVE]: 'neutral',
  [ShopStatus.SUSPENDED]: 'danger',
  [ShopStatus.CREDIT_BLOCKED]: 'danger',
  [ShopStatus.LICENCE_EXPIRED]: 'danger',
};

const USER: Record<UserStatus, BadgeTone> = {
  [UserStatus.ACTIVE]: 'success',
  [UserStatus.INACTIVE]: 'neutral',
  [UserStatus.SUSPENDED]: 'danger',
};

const TONES = {
  order: ORDER,
  delivery: DELIVERY,
  payment: PAYMENT,
  return: RETURN,
  shop: SHOP,
  user: USER,
} as const;

/** The catalogue namespace holding each kind's words. */
const NAMESPACE = {
  order: 'orderStatus',
  delivery: 'deliveryStatus',
  payment: 'paymentStatus',
  return: 'returnStatus',
  shop: 'shopStatus',
  user: 'userStatus',
} as const;

export type StatusKind = keyof typeof TONES;

export type Translate = (path: string, values?: Record<string, string | number>) => string;

/**
 * The label alone, for places where a pill would be too heavy — a page title,
 * a CSV export, a sentence.
 *
 * Takes `t` rather than calling the hook, so it stays usable from a column
 * definition or a callback where a hook cannot go.
 */
export function statusLabel(t: Translate, kind: StatusKind, status: string): string {
  const key = `${NAMESPACE[kind]}.${status}`;
  const label = t(key);
  // `t` hands back the key itself when it is missing, which can only happen for
  // a status from a server newer than this bundle. Show the raw value rather
  // than a dotted key path, but leave it visibly unpolished so it reads as
  // "unexpected" and not as a considered wording.
  return label === key ? status.replaceAll('_', ' ').toLowerCase() : label;
}

export interface StatusPillProps {
  kind: StatusKind;
  status: string;
  className?: string;
}

export function StatusPill({ kind, status, className }: StatusPillProps) {
  const { t } = useLanguage();
  const tone = (TONES[kind] as Record<string, BadgeTone>)[status];
  return (
    <Badge tone={tone ?? 'neutral'} className={className}>
      {statusLabel(t, kind, status)}
    </Badge>
  );
}
