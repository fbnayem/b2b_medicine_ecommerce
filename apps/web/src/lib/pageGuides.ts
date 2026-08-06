import type { Translate } from '@medsupply/i18n';

/**
 * Which explanation belongs under which screen.
 *
 * ## Why this is a table of literal calls rather than three lines of string
 * building
 *
 * The obvious implementation is `t(`guide.${routeId}What`)`, and it would be
 * wrong for a reason this repository has already been bitten by:
 * `catalogueKeys.test.ts` finds keys by reading **literal single-quoted `t()`
 * call sites**, and says so in its own self-test. A template literal is
 * invisible to it, so 219 keys — every explanation in the product — would sit
 * outside the only gate that proves a key resolves to anything. A misspelling
 * would reach a reader as the raw text `guide.orderDetailWhat`, which is
 * exactly the failure the home screen showed a fortnight ago.
 *
 * So every key is written out. The verbosity is the point, and it is the same
 * trade `MedicineForm`'s field table makes for the same reason.
 *
 * ## What belongs in each answer
 *
 * `what` — the job the screen does, in the words a shop uses.
 * `use` — what to do, what to type, and what happens when the button is pressed.
 * `maths` — **only** where the screen shows a figure somebody could disagree
 * with. Most screens have none, and a sentence announcing that there is no
 * arithmetic is worse than the silence it replaces.
 */

export interface Guide {
  what: string;
  use: string;
  maths?: string;
}

const GUIDES: Record<string, (t: Translate) => Guide> = {
  dashboard: (t) => ({
    what: t('guide.dashboardWhat'),
    use: t('guide.dashboardUse'),
    maths: t('guide.dashboardMaths'),
  }),

  orders: (t) => ({ what: t('guide.ordersWhat'), use: t('guide.ordersUse') }),
  'order-detail': (t) => ({
    what: t('guide.orderDetailWhat'),
    use: t('guide.orderDetailUse'),
    maths: t('guide.orderDetailMaths'),
  }),
  'order-entry': (t) => ({
    what: t('guide.orderEntryWhat'),
    use: t('guide.orderEntryUse'),
    maths: t('guide.orderEntryMaths'),
  }),
  cart: (t) => ({
    what: t('guide.cartWhat'),
    use: t('guide.cartUse'),
    maths: t('guide.cartMaths'),
  }),
  checkout: (t) => ({
    what: t('guide.checkoutWhat'),
    use: t('guide.checkoutUse'),
    maths: t('guide.checkoutMaths'),
  }),

  approvals: (t) => ({ what: t('guide.approvalsWhat'), use: t('guide.approvalsUse') }),
  'approval-review': (t) => ({
    what: t('guide.approvalReviewWhat'),
    use: t('guide.approvalReviewUse'),
    maths: t('guide.approvalReviewMaths'),
  }),

  fulfilment: (t) => ({ what: t('guide.fulfilmentWhat'), use: t('guide.fulfilmentUse') }),
  'fulfilment-work': (t) => ({
    what: t('guide.fulfilmentWorkWhat'),
    use: t('guide.fulfilmentWorkUse'),
    maths: t('guide.fulfilmentWorkMaths'),
  }),
  'fulfilment-ready': (t) => ({
    what: t('guide.fulfilmentReadyWhat'),
    use: t('guide.fulfilmentReadyUse'),
  }),

  deliveries: (t) => ({ what: t('guide.deliveriesWhat'), use: t('guide.deliveriesUse') }),
  'delivery-detail': (t) => ({
    what: t('guide.deliveryDetailWhat'),
    use: t('guide.deliveryDetailUse'),
  }),
  trips: (t) => ({ what: t('guide.tripsWhat'), use: t('guide.tripsUse') }),
  'trip-new': (t) => ({ what: t('guide.tripNewWhat'), use: t('guide.tripNewUse') }),
  'trip-detail': (t) => ({ what: t('guide.tripDetailWhat'), use: t('guide.tripDetailUse') }),

  returns: (t) => ({ what: t('guide.returnsWhat'), use: t('guide.returnsUse') }),
  'return-new': (t) => ({ what: t('guide.returnNewWhat'), use: t('guide.returnNewUse') }),
  'return-detail': (t) => ({
    what: t('guide.returnDetailWhat'),
    use: t('guide.returnDetailUse'),
    maths: t('guide.returnDetailMaths'),
  }),

  medicines: (t) => ({ what: t('guide.medicinesWhat'), use: t('guide.medicinesUse') }),
  'medicine-detail': (t) => ({
    what: t('guide.medicineDetailWhat'),
    use: t('guide.medicineDetailUse'),
    maths: t('guide.medicineDetailMaths'),
  }),
  'medicine-new': (t) => ({
    what: t('guide.medicineNewWhat'),
    use: t('guide.medicineNewUse'),
    maths: t('guide.medicineNewMaths'),
  }),
  'medicine-edit': (t) => ({
    what: t('guide.medicineEditWhat'),
    use: t('guide.medicineEditUse'),
    maths: t('guide.medicineNewMaths'),
  }),

  'price-lists': (t) => ({ what: t('guide.priceListsWhat'), use: t('guide.priceListsUse') }),
  'price-list-new': (t) => ({
    what: t('guide.priceListNewWhat'),
    use: t('guide.priceListNewUse'),
  }),
  'price-list-detail': (t) => ({
    what: t('guide.priceListDetailWhat'),
    use: t('guide.priceListDetailUse'),
    maths: t('guide.priceListDetailMaths'),
  }),

  schemes: (t) => ({ what: t('guide.schemesWhat'), use: t('guide.schemesUse') }),
  'scheme-new': (t) => ({
    what: t('guide.schemeNewWhat'),
    use: t('guide.schemeNewUse'),
    maths: t('guide.schemeNewMaths'),
  }),
  'scheme-detail': (t) => ({
    what: t('guide.schemeDetailWhat'),
    use: t('guide.schemeDetailUse'),
    maths: t('guide.schemeNewMaths'),
  }),

  inventory: (t) => ({
    what: t('guide.inventoryWhat'),
    use: t('guide.inventoryUse'),
    maths: t('guide.inventoryMaths'),
  }),
  warehouses: (t) => ({ what: t('guide.warehousesWhat'), use: t('guide.warehousesUse') }),
  'warehouse-new': (t) => ({
    what: t('guide.warehouseNewWhat'),
    use: t('guide.warehouseNewUse'),
  }),
  stocktakes: (t) => ({ what: t('guide.stocktakesWhat'), use: t('guide.stocktakesUse') }),
  'stocktake-new': (t) => ({
    what: t('guide.stocktakeNewWhat'),
    use: t('guide.stocktakeNewUse'),
  }),
  'stocktake-detail': (t) => ({
    what: t('guide.stocktakeDetailWhat'),
    use: t('guide.stocktakeDetailUse'),
    maths: t('guide.stocktakeDetailMaths'),
  }),

  recall: (t) => ({ what: t('guide.recallWhat'), use: t('guide.recallUse') }),
  'controlled-register': (t) => ({
    what: t('guide.controlledRegisterWhat'),
    use: t('guide.controlledRegisterUse'),
    maths: t('guide.controlledRegisterMaths'),
  }),

  suppliers: (t) => ({ what: t('guide.suppliersWhat'), use: t('guide.suppliersUse') }),
  'supplier-new': (t) => ({ what: t('guide.supplierNewWhat'), use: t('guide.supplierNewUse') }),
  'purchase-orders': (t) => ({
    what: t('guide.purchaseOrdersWhat'),
    use: t('guide.purchaseOrdersUse'),
  }),
  'purchase-order-new': (t) => ({
    what: t('guide.purchaseOrderNewWhat'),
    use: t('guide.purchaseOrderNewUse'),
    maths: t('guide.purchaseOrderNewMaths'),
  }),
  'purchase-order-detail': (t) => ({
    what: t('guide.purchaseOrderDetailWhat'),
    use: t('guide.purchaseOrderDetailUse'),
    maths: t('guide.purchaseOrderDetailMaths'),
  }),

  payments: (t) => ({ what: t('guide.paymentsWhat'), use: t('guide.paymentsUse') }),
  'payment-new': (t) => ({
    what: t('guide.paymentNewWhat'),
    use: t('guide.paymentNewUse'),
    maths: t('guide.paymentNewMaths'),
  }),
  'payment-detail': (t) => ({
    what: t('guide.paymentDetailWhat'),
    use: t('guide.paymentDetailUse'),
  }),
  collections: (t) => ({
    what: t('guide.collectionsWhat'),
    use: t('guide.collectionsUse'),
    maths: t('guide.collectionsMaths'),
  }),

  'report-outstanding': (t) => ({
    what: t('guide.reportOutstandingWhat'),
    use: t('guide.reportOutstandingUse'),
    maths: t('guide.reportOutstandingMaths'),
  }),
  'report-overdue': (t) => ({
    what: t('guide.reportOverdueWhat'),
    use: t('guide.reportOverdueUse'),
    maths: t('guide.reportOverdueMaths'),
  }),
  'report-collections': (t) => ({
    what: t('guide.reportCollectionsWhat'),
    use: t('guide.reportCollectionsUse'),
    maths: t('guide.reportCollectionsMaths'),
  }),
  'shop-ledger': (t) => ({
    what: t('guide.shopLedgerWhat'),
    use: t('guide.shopLedgerUse'),
    maths: t('guide.shopLedgerMaths'),
  }),
  'shop-statement': (t) => ({
    what: t('guide.shopStatementWhat'),
    use: t('guide.shopStatementUse'),
    maths: t('guide.shopStatementMaths'),
  }),

  analytics: (t) => ({
    what: t('guide.analyticsWhat'),
    use: t('guide.analyticsUse'),
    maths: t('guide.analyticsMaths'),
  }),
  'analytics-sales': (t) => ({
    what: t('guide.analyticsSalesWhat'),
    use: t('guide.analyticsSalesUse'),
    maths: t('guide.analyticsSalesMaths'),
  }),
  'analytics-returns': (t) => ({
    what: t('guide.analyticsReturnsWhat'),
    use: t('guide.analyticsReturnsUse'),
  }),
  'analytics-inventory': (t) => ({
    what: t('guide.analyticsInventoryWhat'),
    use: t('guide.analyticsInventoryUse'),
    maths: t('guide.analyticsInventoryMaths'),
  }),
  'analytics-deliveries': (t) => ({
    what: t('guide.analyticsDeliveriesWhat'),
    use: t('guide.analyticsDeliveriesUse'),
  }),
  'analytics-receivables': (t) => ({
    what: t('guide.analyticsReceivablesWhat'),
    use: t('guide.analyticsReceivablesUse'),
    maths: t('guide.analyticsReceivablesMaths'),
  }),

  shops: (t) => ({ what: t('guide.shopsWhat'), use: t('guide.shopsUse') }),
  'shop-new': (t) => ({ what: t('guide.shopNewWhat'), use: t('guide.shopNewUse') }),
  'shop-detail': (t) => ({
    what: t('guide.shopDetailWhat'),
    use: t('guide.shopDetailUse'),
    maths: t('guide.shopDetailMaths'),
  }),
  users: (t) => ({ what: t('guide.usersWhat'), use: t('guide.usersUse') }),
  'user-new': (t) => ({ what: t('guide.userNewWhat'), use: t('guide.userNewUse') }),
  settings: (t) => ({ what: t('guide.settingsWhat'), use: t('guide.settingsUse') }),
  audit: (t) => ({ what: t('guide.auditWhat'), use: t('guide.auditUse') }),
  activity: (t) => ({ what: t('guide.activityWhat'), use: t('guide.activityUse') }),

  'shop-account': (t) => ({
    what: t('guide.shopAccountWhat'),
    use: t('guide.shopAccountUse'),
    maths: t('guide.shopAccountMaths'),
  }),
  'my-payments': (t) => ({ what: t('guide.myPaymentsWhat'), use: t('guide.myPaymentsUse') }),
  'my-payment-detail': (t) => ({
    what: t('guide.myPaymentDetailWhat'),
    use: t('guide.myPaymentDetailUse'),
  }),
  'my-statement': (t) => ({
    what: t('guide.myStatementWhat'),
    use: t('guide.myStatementUse'),
    maths: t('guide.myStatementMaths'),
  }),
  addresses: (t) => ({ what: t('guide.addressesWhat'), use: t('guide.addressesUse') }),

  notifications: (t) => ({ what: t('guide.notificationsWhat'), use: t('guide.notificationsUse') }),
  'notification-preferences': (t) => ({
    what: t('guide.notificationPreferencesWhat'),
    use: t('guide.notificationPreferencesUse'),
  }),
  security: (t) => ({ what: t('guide.securityWhat'), use: t('guide.securityUse') }),
  'change-password': (t) => ({
    what: t('guide.changePasswordWhat'),
    use: t('guide.changePasswordUse'),
  }),
};

/** The explanation for a screen, or nothing where none is written. */
export function guideFor(routeId: string, t: Translate): Guide | undefined {
  return GUIDES[routeId]?.(t);
}

/** Which routes have one. Read by `pageGuides.test.ts` to find the gaps. */
export function routesWithGuides(): string[] {
  return Object.keys(GUIDES);
}
