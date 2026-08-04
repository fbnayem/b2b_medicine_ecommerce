import type { ReactNode } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import {
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
  ReturnStatus,
  ShopStatus,
  UserStatus,
} from '@medsupply/shared-types';
import { amber, blue, green, neutral, red } from '@medsupply/design-tokens';
import { layout } from '../theme';
import { useLanguage } from '../i18n/useLanguage';

/**
 * One status, one colour, one wording — and the same ones the web client uses.
 *
 * Mobile rendered statuses with its own `replaceAll('_', ' ')` calls, so the
 * order a manager saw as "Ready for delivery" on a desktop read
 * `READY FOR DELIVERY` on the phone in the warehouse. This is the same split
 * the web `StatusPill` makes: **the colour lives here, the words live in the
 * catalogue**, because a colour is not translatable and a word is.
 *
 * The tone maps are `Record<Status, BadgeTone>`, so adding a member to any
 * status enum in `@medsupply/shared-types` is a compile error here until it has
 * a colour, and a compile error in `packages/i18n` until it has words in both
 * languages.
 */

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

/**
 * A tint and a darker ink from the same ramp.
 *
 * Both are taken from the token package rather than typed in: the two brand
 * greens this application shipped side by side came from exactly this kind of
 * small local colour decision.
 */
const TONE_COLOURS: Record<BadgeTone, { background: string; text: string }> = {
  neutral: { background: neutral[100], text: neutral[700] },
  brand: { background: green[100], text: green[700] },
  success: { background: green[100], text: green[700] },
  warning: { background: amber[100], text: amber[700] },
  danger: { background: red[100], text: red[700] },
  info: { background: blue[100], text: blue[700] },
};

export function Badge({
  children,
  tone = 'neutral',
  style,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  style?: ViewStyle;
}) {
  const { background, text } = TONE_COLOURS[tone];
  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: background,
          borderRadius: layout.radius.full,
          paddingHorizontal: layout.space[2],
          paddingVertical: layout.space[1],
        },
        style,
      ]}
    >
      <Text style={{ color: text, fontSize: layout.fontSize.sm, fontWeight: '600' }}>
        {children}
      </Text>
    </View>
  );
}

const ORDER: Record<OrderStatus, BadgeTone> = {
  [OrderStatus.DRAFT]: 'neutral',
  [OrderStatus.SUBMITTED]: 'info',
  [OrderStatus.UNDER_REVIEW]: 'info',
  [OrderStatus.ON_HOLD]: 'warning',
  [OrderStatus.APPROVED]: 'success',
  [OrderStatus.PARTIALLY_APPROVED]: 'warning',
  [OrderStatus.REJECTED]: 'danger',
  [OrderStatus.PREPARING]: 'info',
  [OrderStatus.PACKING]: 'info',
  [OrderStatus.PACKED]: 'info',
  [OrderStatus.INVOICE_GENERATED]: 'info',
  [OrderStatus.READY_FOR_DELIVERY]: 'info',
  [OrderStatus.DELIVERY_ASSIGNED]: 'info',
  [OrderStatus.HANDED_TO_DELIVERY]: 'info',
  [OrderStatus.PICKED_UP]: 'info',
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
  [DeliveryStatus.ASSIGNED]: 'info',
  [DeliveryStatus.HANDED_OVER]: 'info',
  [DeliveryStatus.PICKED_UP]: 'info',
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
  [ReturnStatus.COLLECTED]: 'info',
  [ReturnStatus.RECEIVED]: 'info',
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

type Translate = (path: string, values?: Record<string, string | number>) => string;

/** The label alone, for a sentence or a heading where a pill is too heavy. */
export function statusLabel(t: Translate, kind: StatusKind, status: string): string {
  const key = `${NAMESPACE[kind]}.${status}`;
  const label = t(key);
  // `t` hands back the key when it is missing, which can only happen for a
  // status from a server newer than this build. Show the raw value rather than
  // a dotted path, left visibly unpolished so it reads as unexpected.
  return label === key ? status.replaceAll('_', ' ').toLowerCase() : label;
}

export function StatusPill({
  kind,
  status,
  style,
}: {
  kind: StatusKind;
  status: string;
  style?: ViewStyle;
}) {
  const { t } = useLanguage();
  const tone = (TONES[kind] as Record<string, BadgeTone>)[status];
  return (
    <Badge tone={tone ?? 'neutral'} style={style}>
      {statusLabel(t, kind, status)}
    </Badge>
  );
}
