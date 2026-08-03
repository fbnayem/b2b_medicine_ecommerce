import {
  NotificationCategory,
  NotificationChannel,
  NotificationEvent,
  NotificationPriority,
} from '@medsupply/shared-types';

/**
 * Values a template may interpolate. Everything is optional so a caller can
 * emit an event without knowing which template consumes which field; templates
 * fall back to neutral wording rather than rendering `undefined`.
 */
export interface TemplateContext {
  reference?: string;
  shopName?: string;
  actorName?: string;
  receiverName?: string;
  status?: string;
  note?: string;
  reason?: string;
  amountMinor?: number;
  count?: number;
  date?: string;
  code?: string;
  orderId?: string;
  shopId?: string;
  invoiceId?: string;
  deliveryId?: string;
  paymentId?: string;
  pickingListId?: string;
  medicineId?: string;
  returnId?: string;
  creditNoteId?: string;
}

export interface RenderedNotification {
  title: string;
  body: string;
  link?: string;
}

export interface NotificationTemplate {
  event: NotificationEvent;
  category: NotificationCategory;
  priority: NotificationPriority;
  /** Optional channels used when the recipient has saved no preference. */
  defaultChannels: NotificationChannel[];
  render(context: TemplateContext): RenderedNotification;
}

const { EMAIL, PUSH, SMS } = NotificationChannel;

/**
 * Formats integer poisha as BDT for display only. Uses integer arithmetic so a
 * notification body can never disagree with the ledger through float rounding.
 */
export function formatBdt(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor)) throw new Error('Amount must be an integer minor value');
  const negative = amountMinor < 0;
  const absolute = Math.abs(amountMinor);
  const major = Math.trunc(absolute / 100);
  const fraction = absolute % 100;
  const grouped = major.toLocaleString('en-US');
  return `${negative ? '-' : ''}৳${grouped}.${String(fraction).padStart(2, '0')}`;
}

const orderLink = (context: TemplateContext) =>
  context.orderId ? `/orders/${context.orderId}` : undefined;
const deliveryLink = (context: TemplateContext) =>
  context.deliveryId ? `/deliveries/${context.deliveryId}` : undefined;
const paymentLink = (context: TemplateContext) =>
  context.paymentId ? `/payments/${context.paymentId}` : undefined;
const fulfilmentLink = (context: TemplateContext) =>
  context.pickingListId ? `/fulfilment/${context.pickingListId}` : undefined;
const returnLink = (context: TemplateContext) =>
  context.returnId ? `/returns/${context.returnId}` : undefined;

const reference = (context: TemplateContext, fallback = 'the record') =>
  context.reference ?? fallback;

const template = (
  event: NotificationEvent,
  category: NotificationCategory,
  priority: NotificationPriority,
  defaultChannels: NotificationChannel[],
  render: (context: TemplateContext) => RenderedNotification,
): NotificationTemplate => ({ event, category, priority, defaultChannels, render });

const templates: NotificationTemplate[] = [
  template(
    NotificationEvent.ORDER_SUBMITTED,
    NotificationCategory.ORDER,
    NotificationPriority.NORMAL,
    [PUSH],
    (context) => ({
      title: `Order ${reference(context)} submitted`,
      body: `${context.shopName ?? 'A shop'} submitted an order request.`,
      link: orderLink(context),
    }),
  ),
  template(
    NotificationEvent.ORDER_UNDER_REVIEW,
    NotificationCategory.APPROVAL,
    NotificationPriority.LOW,
    [PUSH],
    (context) => ({
      title: `Order ${reference(context)} is under review`,
      body: context.actorName
        ? `${context.actorName} started reviewing this order.`
        : 'A manager started reviewing this order.',
      link: orderLink(context),
    }),
  ),
  template(
    NotificationEvent.ORDER_ON_HOLD,
    NotificationCategory.APPROVAL,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: `Order ${reference(context)} is on hold`,
      body: context.note ?? 'The manager placed this order on hold pending clarification.',
      link: orderLink(context),
    }),
  ),
  template(
    NotificationEvent.ORDER_REJECTED,
    NotificationCategory.APPROVAL,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: `Order ${reference(context)} was rejected`,
      body: context.note ?? context.reason ?? 'The manager rejected this order request.',
      link: orderLink(context),
    }),
  ),
  template(
    NotificationEvent.ORDER_APPROVED,
    NotificationCategory.APPROVAL,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: `Order ${reference(context)} reviewed`,
      body: `Status: ${(context.status ?? 'APPROVED').replaceAll('_', ' ')}.`,
      link: orderLink(context),
    }),
  ),
  template(
    NotificationEvent.ORDER_CANCELLATION_REQUESTED,
    NotificationCategory.ORDER,
    NotificationPriority.NORMAL,
    [PUSH],
    (context) => ({
      title: `Cancellation asked for order ${reference(context)}`,
      body: context.reason
        ? `Reason: ${context.reason}`
        : 'The shop has asked to cancel this order.',
      link: orderLink(context),
    }),
  ),
  template(
    NotificationEvent.ORDER_CANCELLATION_REFUSED,
    NotificationCategory.ORDER,
    NotificationPriority.NORMAL,
    [PUSH],
    (context) => ({
      title: `Order ${reference(context)} was not cancelled`,
      body: context.reason ?? 'Your cancellation request was not granted.',
      link: orderLink(context),
    }),
  ),
  template(
    NotificationEvent.ORDER_CANCELLED,
    NotificationCategory.ORDER,
    NotificationPriority.NORMAL,
    [PUSH],
    (context) => ({
      title: `Order ${reference(context)} cancelled`,
      body: context.reason ?? 'This order was cancelled.',
      link: orderLink(context),
    }),
  ),
  template(
    NotificationEvent.PICKING_READY,
    NotificationCategory.FULFILMENT,
    NotificationPriority.NORMAL,
    [PUSH],
    (context) => ({
      title: `Order ${reference(context)} ready`,
      body: 'An approved order is ready for picking.',
      link: orderLink(context),
    }),
  ),
  template(
    NotificationEvent.PICKING_DISCREPANCY,
    NotificationCategory.FULFILMENT,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: 'Picking discrepancy requires review',
      body: context.note ?? 'A storekeeper reported a discrepancy that blocks the picking list.',
      link: fulfilmentLink(context),
    }),
  ),
  template(
    NotificationEvent.PICKING_DISCREPANCY_RESOLVED,
    NotificationCategory.FULFILMENT,
    NotificationPriority.NORMAL,
    [PUSH],
    (context) => ({
      title: 'Picking discrepancy resolved',
      body: context.note ?? 'Management resolved the reported discrepancy. Picking may continue.',
      link: fulfilmentLink(context),
    }),
  ),
  template(
    NotificationEvent.PACKING_SHORTFALL,
    NotificationCategory.FULFILMENT,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: `Packing shortfall for ${reference(context)}`,
      body: 'Unused picking quantities were released and the invoice was recalculated.',
      link: orderLink(context),
    }),
  ),
  template(
    NotificationEvent.INVOICE_ISSUED,
    NotificationCategory.FINANCE,
    NotificationPriority.NORMAL,
    [PUSH, EMAIL],
    (context) => ({
      title: `Invoice ${reference(context)} issued`,
      body: context.amountMinor
        ? `The order is packed and invoiced for ${formatBdt(context.amountMinor)}.`
        : 'The order is packed and invoiced.',
      link: orderLink(context),
    }),
  ),
  template(
    NotificationEvent.DELIVERY_ASSIGNED,
    NotificationCategory.DELIVERY,
    NotificationPriority.HIGH,
    [PUSH],
    (context) => ({
      title: `Delivery ${reference(context)} assigned`,
      body: context.date
        ? `Expected delivery: ${context.date}.`
        : 'A delivery was assigned to you.',
      link: deliveryLink(context),
    }),
  ),
  template(
    NotificationEvent.DELIVERY_HANDED_OVER,
    NotificationCategory.DELIVERY,
    NotificationPriority.HIGH,
    [PUSH],
    (context) => ({
      title: `${reference(context)} is ready for acknowledgement`,
      body: 'Confirm receipt of the package before pickup.',
      link: deliveryLink(context),
    }),
  ),
  template(
    NotificationEvent.DELIVERY_PICKED_UP,
    NotificationCategory.DELIVERY,
    NotificationPriority.NORMAL,
    [PUSH],
    (context) => ({
      title: `${reference(context)} picked up`,
      body: 'The delivery person collected the package from the store.',
      link: deliveryLink(context),
    }),
  ),
  template(
    NotificationEvent.DELIVERY_OUT_FOR_DELIVERY,
    NotificationCategory.DELIVERY,
    NotificationPriority.NORMAL,
    [PUSH, SMS],
    (context) => ({
      title: `${reference(context)} is on the way`,
      body: 'Your order is out for delivery.',
      link: deliveryLink(context),
    }),
  ),
  template(
    NotificationEvent.DELIVERY_COMPLETED,
    NotificationCategory.DELIVERY,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: `${reference(context)} completed`,
      body: `${context.count ?? 1} package(s) were received${
        context.receiverName ? ` by ${context.receiverName}` : ''
      }.`,
      link: deliveryLink(context),
    }),
  ),
  template(
    NotificationEvent.DELIVERY_FAILED,
    NotificationCategory.DELIVERY,
    NotificationPriority.CRITICAL,
    [PUSH, EMAIL, SMS],
    (context) => ({
      title: `${reference(context)} failed`,
      body: `${(context.reason ?? 'OTHER').replaceAll('_', ' ')}: ${context.note ?? 'No further detail was recorded.'}`,
      link: deliveryLink(context),
    }),
  ),
  template(
    NotificationEvent.DELIVERY_RETURNED,
    NotificationCategory.DELIVERY,
    NotificationPriority.HIGH,
    [PUSH],
    (context) => ({
      title: `${reference(context)} returned to store`,
      body: 'The package is back in store custody and can be reassigned.',
      link: deliveryLink(context),
    }),
  ),
  template(
    NotificationEvent.DELIVERY_OTP,
    NotificationCategory.SECURITY,
    NotificationPriority.CRITICAL,
    [SMS, PUSH],
    (context) => ({
      title: `Delivery verification for ${reference(context)}`,
      body: `Your delivery verification code is ${context.code ?? '------'}. It expires in ${context.count ?? 10} minutes.`,
      link: deliveryLink(context),
    }),
  ),
  template(
    NotificationEvent.PAYMENT_RECORDED,
    NotificationCategory.FINANCE,
    NotificationPriority.NORMAL,
    [PUSH],
    (context) => ({
      title: `Payment ${reference(context)} recorded`,
      body: context.amountMinor
        ? `${formatBdt(context.amountMinor)} was recorded and is awaiting verification.`
        : 'A payment was recorded and is awaiting verification.',
      link: paymentLink(context),
    }),
  ),
  template(
    NotificationEvent.PAYMENT_POSTED,
    NotificationCategory.FINANCE,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: `Payment ${reference(context)} posted`,
      body: context.amountMinor
        ? `${formatBdt(context.amountMinor)} was posted to your account.`
        : 'A payment was posted to your account.',
      link: paymentLink(context),
    }),
  ),
  template(
    NotificationEvent.PAYMENT_FAILED,
    NotificationCategory.FINANCE,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: `Payment ${reference(context)} failed`,
      body: context.reason ?? 'The payment could not be posted.',
      link: paymentLink(context),
    }),
  ),
  template(
    NotificationEvent.PAYMENT_REVERSED,
    NotificationCategory.FINANCE,
    NotificationPriority.CRITICAL,
    [PUSH, EMAIL, SMS],
    (context) => ({
      title: `Payment ${reference(context)} reversed`,
      body: context.reason ?? 'A posted payment was reversed with a balancing journal.',
      link: paymentLink(context),
    }),
  ),
  template(
    NotificationEvent.CREDIT_BLOCKED,
    NotificationCategory.FINANCE,
    NotificationPriority.CRITICAL,
    [PUSH, EMAIL, SMS],
    (context) => ({
      title: `Ordering blocked for ${context.shopName ?? 'your shop'}`,
      body: context.reason ?? 'The credit limit or overdue threshold was exceeded.',
      link: context.shopId ? `/shops/${context.shopId}` : undefined,
    }),
  ),
  template(
    NotificationEvent.INVOICE_OVERDUE,
    NotificationCategory.FINANCE,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: `${context.count ?? 1} invoice(s) overdue`,
      body: context.amountMinor
        ? `${formatBdt(context.amountMinor)} is past its payment terms.`
        : 'One or more invoices are past their payment terms.',
      link: context.shopId ? `/shops/${context.shopId}/statement` : '/account/statement',
    }),
  ),
  template(
    NotificationEvent.STOCK_NEAR_EXPIRY,
    NotificationCategory.INVENTORY,
    NotificationPriority.NORMAL,
    [PUSH, EMAIL],
    (context) => ({
      title: `${context.count ?? 1} batch(es) near expiry`,
      body: 'Review near-expiry stock before it can no longer be allocated.',
      link: '/inventory',
    }),
  ),
  template(
    NotificationEvent.RETURN_REQUESTED,
    NotificationCategory.ORDER,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: `Return ${reference(context)} requested`,
      body: `${context.shopName ?? 'A shop'} requested a return${
        context.reason ? ` for ${context.reason.replaceAll('_', ' ').toLowerCase()}` : ''
      }.`,
      link: returnLink(context),
    }),
  ),
  template(
    NotificationEvent.RETURN_APPROVED,
    NotificationCategory.ORDER,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: `Return ${reference(context)} ${(context.status ?? 'APPROVED') === 'PARTIALLY_APPROVED' ? 'partly approved' : 'approved'}`,
      body: context.amountMinor
        ? `Approved for up to ${formatBdt(context.amountMinor)} in credit once the goods are received.`
        : 'The goods will be collected and inspected before credit is issued.',
      link: returnLink(context),
    }),
  ),
  template(
    NotificationEvent.RETURN_REJECTED,
    NotificationCategory.ORDER,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: `Return ${reference(context)} rejected`,
      body: context.reason ?? 'The return request was rejected.',
      link: returnLink(context),
    }),
  ),
  template(
    NotificationEvent.RETURN_COLLECTED,
    NotificationCategory.ORDER,
    NotificationPriority.NORMAL,
    [PUSH],
    (context) => ({
      title: `Return ${reference(context)} collected`,
      body: 'The returned goods are on their way back to the warehouse.',
      link: returnLink(context),
    }),
  ),
  template(
    NotificationEvent.RETURN_RECEIVED,
    NotificationCategory.INVENTORY,
    NotificationPriority.NORMAL,
    [PUSH],
    (context) => ({
      title: `Return ${reference(context)} received`,
      body: `${context.count ?? 0} unit(s) were inspected and booked in. A credit note is awaiting approval.`,
      link: returnLink(context),
    }),
  ),
  template(
    NotificationEvent.CREDIT_NOTE_ISSUED,
    NotificationCategory.FINANCE,
    NotificationPriority.HIGH,
    [PUSH, EMAIL],
    (context) => ({
      title: `Credit note ${reference(context)} issued`,
      body: context.amountMinor
        ? `${formatBdt(context.amountMinor)} was credited to your account.`
        : 'A credit note was applied to your account.',
      link: returnLink(context),
    }),
  ),
];

const templatesByEvent = new Map<NotificationEvent, NotificationTemplate>(
  templates.map((entry) => [entry.event, entry]),
);

export function templateFor(event: NotificationEvent): NotificationTemplate {
  const found = templatesByEvent.get(event);
  if (!found) throw new Error(`No notification template registered for event ${event}`);
  return found;
}

export function allTemplates(): NotificationTemplate[] {
  return [...templates];
}
