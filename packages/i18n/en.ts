import {
  OrderStatus,
  DeliveryStatus,
  NotificationCategory,
  NotificationChannel,
  PaymentMethod,
  PaymentStatus,
  ReturnReason,
  ReturnStatus,
  ShopStatus,
  UserRole,
} from '@medsupply/shared-types';

/**
 * The English catalogue, and the shape every other language must match.
 *
 * A **TypeScript object literal, not JSON**, so `bn.ts` can be typed
 * `typeof en` — a missing or extra Bangla key becomes a compile error rather
 * than a screen that renders a key name at somebody in Dhaka.
 *
 * The status maps are `Record<Status, string>`, so adding a member to any
 * status enum in `@medsupply/shared-types` fails the build here until it has
 * been given words. That is what turns "the new status shows as raw
 * PARTIALLY_DELIVERED" from something a user reports into something the
 * compiler refuses.
 *
 * **Plain language is the rule, not a preference.** The people using this are
 * warehouse pickers, delivery riders, shop owners and accounts clerks. Nothing
 * here says FEFO, poisha, idempotency, immutable, ledger, basis points or
 * quarantine unless the reader is an accountant and the word is the right one.
 */
export const en = {
  common: {
    appName: 'MedSupply B2B',
    loading: 'Loading',
    retry: 'Try again',
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
    search: 'Search',
    goHome: 'Go to the home screen',
    signIn: 'Sign in',
    signOut: 'Sign out',
    somethingWentWrong: 'Something went wrong',
    nothingHere: 'There is nothing here yet',
    reference: 'Reference',
    quoteReference: 'Quote this reference if you contact support',
  },

  auth: {
    signInTitle: 'Sign in to your account',
    email: 'Email address',
    password: 'Password',
    signingIn: 'Signing in…',
    invalidCredentials: 'That email address and password do not match an account.',
    changePassword: 'Change your password',
    currentPassword: 'Your current password',
    newPassword: 'New password',
    repeatPassword: 'New password again',
    passwordsDoNotMatch: 'These do not match.',
    passwordTooShort: 'Use at least {{minimum}} characters.',
    mustChangeTitle: 'Choose your own password',
    mustChangeBody:
      'Somebody set this password for you, so it is known to more than one person. Choose one only you know before you carry on.',
  },

  /**
   * The vocabulary every page shares.
   *
   * Zero of the 53 web pages called the translation function, so the switch
   * changed the shell and nothing inside it. Most of what those pages say is
   * not bespoke — it is "Add", "Status", "Showing 1–50 of 384" — and putting
   * that here first means converting a page is mostly wiring rather than
   * writing, and that two pages cannot end up with "Delete" and "Remove" for
   * the same button.
   */
  actions: {
    add: 'Add',
    edit: 'Edit',
    view: 'View',
    remove: 'Remove',
    create: 'Create',
    submit: 'Submit',
    confirm: 'Confirm',
    approve: 'Approve',
    reject: 'Reject',
    refresh: 'Refresh',
    export: 'Export',
    print: 'Print',
    back: 'Back',
    apply: 'Apply',
    clear: 'Clear',
    filter: 'Filter',
    reason: 'Reason',
    // A destructive action names what it destroys at the call site; this is
    // only the verb.
    delete: 'Delete',
  },

  /**
   * Column headings and field labels. One word per concept across every
   * screen — a "Reference" is never a "Ref" on the next page.
   */
  fields: {
    reference: 'Reference',
    date: 'Date',
    status: 'Status',
    quantity: 'Quantity',
    amount: 'Amount',
    total: 'Total',
    customer: 'Customer',
    shop: 'Shop',
    medicine: 'Medicine',
    brand: 'Brand',
    batch: 'Batch',
    expiry: 'Expiry',
    price: 'Price',
    notes: 'Notes',
    phone: 'Phone',
    email: 'Email address',
    address: 'Address',
    createdBy: 'Created by',
    createdAt: 'Created',
    dueDate: 'Due',
    outstanding: 'Outstanding',
  },

  /** Lists, tables and the things said around them. */
  lists: {
    searchPlaceholder: 'Search…',
    noResults: 'Nothing matched that search',
    noResultsBody: 'Check the spelling, or clear the filters and try again.',
    showing: 'Showing {{first}}–{{last}} of {{total}}',
    previous: 'Previous',
    next: 'Next',
    pagination: 'Pagination',
    loadingList: 'Loading {{what}}',
    couldNotLoad: 'This could not be loaded.',
  },

  /**
   * The ordering journey, which is the path most of this product's users walk
   * most weeks — catalogue, order, send, then read it back.
   */
  catalogue: {
    title: 'Medicines',
    subtitle: 'Browse what is available and add it to your order.',
    searchLabel: 'Search the catalogue',
    searchPlaceholder: 'Brand, generic, manufacturer, SKU or barcode',
    addMedicine: 'Add a medicine',
    stock: 'Stock',
    loading: 'Loading medicines',
    couldNotLoad: 'The catalogue could not be loaded.',
    none: 'No medicines matched',
    noneBody: 'Try a shorter search — a brand name on its own usually finds it.',
    available: 'In stock',
    outOfStock: 'Out of stock',
    addToOrder: 'Add to order',
    listedActive: 'Available to order',
    listedInactive: 'Not available',
    back: 'Back to the catalogue',
    about: 'About this medicine',
    manufacturer: 'Manufacturer',
    category: 'Category',
    classification: 'Classification',
    coldChain: 'Needs refrigeration',
    yes: 'Yes',
    no: 'No',
    orderLimits: 'How many you may order',
    noMaximum: 'no maximum',
    yourPrice: 'Your price',
    availability: 'Availability',
    loadingOne: 'Loading this medicine',
    couldNotLoadOne: 'This medicine could not be loaded.',
    batches: 'Stock on hand',
    manageStock: 'Manage stock',
    noBatches: 'No stock has been received yet.',
    reserved: 'Reserved',
    location: 'Where it is',
  },

  cart: {
    title: 'Your order',
    subtitle: 'Nothing is set aside until a manager approves it.',
    keepBrowsing: 'Keep browsing',
    empty: 'Your order is empty',
    emptyBody: 'Add medicines from the catalogue and they will appear here.',
    browse: 'Browse medicines',
    unitPrice: 'Unit price',
    lineTotal: 'Line total',
    quantityFor: 'How many {{brand}}',
    minimum: 'At least {{minimum}}',
    minimumAndMaximum: 'At least {{minimum}}, at most {{maximum}}',
    subtotal: 'Estimated subtotal',
    saveDraft: 'Save for later',
    draftSaved: 'Saved. You can come back to this order later.',
    checkout: 'Review and send',
  },

  checkout: {
    title: 'Send your order',
    subtitle: 'Prices, limits and stock are checked once more when you send it.',
    empty: 'There is nothing to send',
    emptyBody: 'Add medicines to your order first.',
    deliveryAddress: 'Where should it go?',
    selectAddress: 'Choose an address',
    couldNotLoadAddresses: 'Your delivery addresses could not be loaded.',
    paymentMethod: 'How you plan to pay',
    purchaseOrder: 'Your purchase-order number',
    purchaseOrderHint:
      'Optional. It is printed on the invoice so you can match it to your own paperwork.',
    deliveryNotes: 'Anything the rider should know',
    submit: 'Send this order',
    submitting: 'Sending…',
    failed: 'Your order could not be sent.',
  },

  orders: {
    title: 'Orders',
    subtitle: 'Every order you have placed, newest first.',
    start: 'Start an order',
    loading: 'Loading your orders',
    couldNotLoad: 'Your orders could not be loaded.',
    none: 'No orders yet',
    noneBody: 'Browse the catalogue and add what you need — an order starts there.',
    itemCount: 'Items',
    estimate: 'Estimate',
    loadingOne: 'Loading this order',
    couldNotLoadOne: 'This order could not be loaded.',
    submitted: 'Your order has been sent for approval.',
    repeat: 'Order this again',
    requestCancellation: 'Ask to cancel',
    trackDelivery: 'Track the delivery',
    all: 'All orders',
    cancellationRequested: 'You have asked for this order to be cancelled.',
    whatYouOrdered: 'What you ordered',
    estimatedTotal: 'Estimated total',
    timeline: 'What has happened so far',
    activity: 'Order activity',
    cancelTitle: 'Ask to cancel this order',
    cancelBody:
      'A manager decides cancellations. You will be told whether yours was granted, and the order carries on in the meantime.',
    cancelLabel: 'Why do you want to cancel it?',
    cancelConfirm: 'Send the request',
  },

  returns: {
    titleOwner: 'Your returns',
    titleStaff: 'Customer returns',
    subtitleOwner:
      'Send goods back against a delivered invoice and follow it through to the credit note.',
    subtitleStaff: 'Review, receive and credit returned goods.',
    request: 'Request a return',
    loading: 'Loading returns',
    couldNotLoad: 'Returns could not be loaded.',
    forbidden: 'Your account cannot see returns.',
    none: 'No returns yet',
    noneBody: 'A return starts from a delivered invoice.',
    noneFiltered: 'No returns match these filters',
    allStatuses: 'Any status',
    referenceHint: 'RET-2026-000001',
    columnReturn: 'Return',
    columnInvoice: 'Invoice',
    columnRequested: 'Requested',
    columnReason: 'Reason',
    columnValue: 'Value',
    requestTitle: 'Request a return',
    requestSubtitle: 'Choose a delivered invoice, then the items and quantities to send back.',
    loadingInvoices: 'Loading your invoices',
    couldNotLoadInvoices: 'Your invoices could not be loaded.',
    cannotRequest: 'Your account cannot request returns.',
    noInvoices: 'You have no invoices yet',
    noInvoicesBody: 'There is nothing to return until an invoice has been issued.',
    invoice: 'Invoice',
    selectInvoice: 'Choose an invoice',
    mainReason: 'Main reason',
    loadingLines: 'Loading the items on that invoice',
    couldNotLoadLines: 'The items on that invoice could not be loaded.',
    noLines: 'That invoice has nothing that can be returned.',
    columnItem: 'Item',
    columnInvoiced: 'How many were sent',
    columnReturnQuantity: 'How many to send back',
    quantityFor: 'How many {{brand}} to send back',
    reasonFor: 'Why {{brand}} is coming back',
    expires: 'Expires {{date}}',
    notesForSupplier: 'Anything we should know',
    estimate: 'Estimated credit if all of it is approved: {{amount}}',
    estimateBody: 'The final credit is worked out from the goods actually received and inspected.',
    needQuantity: 'Enter a quantity for at least one item.',
    tooMany: 'You can send back at most {{maximum}} of {{brand}}.',
    submit: 'Send this request',
    submitting: 'Sending…',
    submitFailed: 'This return request could not be sent.',
  },

  returnDetail: {
    loading: 'Loading this return',
    couldNotLoad: 'This return could not be loaded.',
    requestedBy: 'Requested {{when}} by {{who}}',
    requestedOn: 'Requested {{when}}',
    all: 'All returns',
    requestedValue: 'Value requested',
    creditSubtotal: 'Credit before tax',
    creditTax: 'Tax on the credit',
    creditTotal: 'Credit total',
    references: 'What this is against',
    order: 'Order',
    mainReason: 'Main reason',
    progress: 'Where it has got to',
    reviewed: 'Reviewed',
    collected: 'Collected',
    received: 'Received',
    creditNote: 'Credit note',
    notYet: 'Not yet',
    notIssued: 'Not issued yet',
    customerNotes: 'What the customer told us',
    rejectionReason: 'Why it was refused',
    internalNotes: 'Internal notes',
    items: 'What is coming back',
    columnInvoiced: 'Sent',
    columnRequested: 'Asked to return',
    columnApproved: 'Agreed',
    columnReceived: 'Received',
    columnDisposition: 'Where it went',
    columnCredit: 'Credit',
    restocked: '{{count}} back on the shelf',
    damaged: '{{count}} damaged',
    expiredUnits: '{{count}} expired',
    quarantined: '{{count}} held back',
    reviewTitle: 'Decide this return',
    reviewBody: 'Agree the quantities you accept. Agreeing to none records the return as refused.',
    approveColumn: 'Agree to',
    approvedFor: 'Quantity agreed for {{brand}}',
    reviewNotes: 'Notes on this decision',
    startReview: 'Start reviewing',
    claiming: 'Starting…',
    saveDecision: 'Save this decision',
    saving: 'Saving…',
    rejectReturn: 'Refuse the return',
    rejecting: 'Refusing…',
    rejectionLabel: 'Why you are refusing it',
    receiveTitle: 'Receive and check',
    receiveBody:
      'Record where each unit goes. Only units put back on the shelf return to saleable stock, and an expired batch cannot go back.',
    restock: 'Back on the shelf',
    damagedColumn: 'Damaged',
    expiredColumn: 'Expired',
    quarantineColumn: 'Held back',
    countedOf: '{{counted}} of {{approved}}',
    dispositionFor: '{{field}} quantity for {{brand}}',
    confirmReceipt: 'Confirm what arrived',
    bookingIn: 'Booking in…',
    actions: 'What you can do',
    markCollected: 'Mark as collected',
    issueCreditNote: 'Issue the credit note',
    issuing: 'Issuing…',
    cancelReturn: 'Cancel this return',
    cancelling: 'Cancelling…',
    noActions: 'There is nothing for your role to do at this stage.',
    confirmCreditTitle: 'Issue a credit note for {{amount}}?',
    confirmCreditBody:
      'This posts to the customer’s account straight away and cannot be edited afterwards. The amount comes off what they owe.',
    cancelTitle: 'Cancel this return request',
    cancelBody:
      'The claim against the invoice is released, so the invoice goes back to being due in full.',
    cancelConfirm: 'Cancel the return',
    claimed: 'You are now reviewing this return.',
    decisionSaved: 'Decision saved.',
    rejected: 'Return refused.',
    collectedDone: 'Marked as collected from the shop.',
    receivedDone: 'Goods received and stock updated.',
    creditIssued: 'Credit note issued and posted to the account.',
    cancelled: 'Return cancelled.',
    actionFailed: 'That could not be done.',
  },

  account: {
    title: 'Your account',
    subtitle: 'Invoices, payments, what is outstanding and what credit is left.',
    paymentHistory: 'Payment history',
    statement: 'Account statement',
    loading: 'Loading your account',
    couldNotLoad: 'Your account could not be loaded.',
    invoices: 'Invoices',
    noInvoices: 'No invoices have been issued yet.',
    invoiceDate: 'Issued',
    remaining: 'Still owing',
    document: 'Invoice',
    openPdf: 'Open the invoice',
    pdfFailed: 'That invoice could not be opened.',
    recentPayments: 'Recent payments',
    viewAll: 'See all',
    noPayments: 'No payments recorded yet.',
  },

  statement: {
    title: 'Account statement',
    ownTitle: 'Your statement',
    subtitle: 'Opening balance through to closing balance for the period you choose.',
    from: 'From',
    to: 'To',
    generate: 'Show the statement',
    print: 'Print or save as PDF',
    loading: 'Preparing the statement',
    couldNotLoad: 'This statement could not be prepared.',
    openingBalance: 'Opening balance',
    closingBalance: 'Closing balance',
    noEntries: 'Nothing happened on this account in that period.',
    description: 'What it was',
    debit: 'Charged',
    credit: 'Paid or credited',
    balance: 'Balance',
  },

  notifications: {
    title: 'Notifications',
    subtitle: 'What has happened that you asked to be told about.',
    loading: 'Loading your notifications',
    couldNotLoad: 'Your notifications could not be loaded.',
    none: 'Nothing to catch up on',
    noneBody: 'You will be told here when something needs your attention.',
    markAllRead: 'Mark everything as read',
    markRead: 'Mark as read',
    unreadOnly: 'Unread only',
    all: 'Everything',
    preferences: 'Choose what you are told about',
    preferencesTitle: 'Notification settings',
    preferencesSubtitle: 'Choose which events reach you, and how.',
    loadingPreferences: 'Loading your settings',
    couldNotLoadPreferences: 'Your notification settings could not be loaded.',
    saved: 'Saved.',
    saveFailed: 'Those settings could not be saved.',
    event: 'What happened',
    allCategories: 'Everything',
    category: 'Category',
    markPageRead: 'Mark these as read',
    archive: 'Archive',
    read: 'Read',
    markedRead: 'Marked as read.',
    archived: 'Archived.',
    updateFailed: 'Those notifications could not be updated.',
    allCaughtUp: 'You have read everything here',
    noneInCategory: 'Nothing in this category yet',
    quietHours: 'Quiet hours',
    quietHoursBody:
      'Phone alerts, SMS and WhatsApp are held back during these hours. Email still arrives, and anything urgent — a delivery code, for instance — always comes through.',
    quietHoursEnable: 'Hold messages during these hours',
    quietFrom: 'From',
    quietTo: 'To',
    channelsByEvent: 'What reaches you, and how',
    inAppAlways: 'You always see these in the app. These settings are about everything else.',
    mute: 'Mute',
    muteEvent: 'Mute {{event}}',
    channelForEvent: '{{channel}} for {{event}}',
    save: 'Save these settings',
    discard: 'Undo my changes',
    unavailable: 'These settings are not available.',
  },

  /** The five ways a message can reach somebody. */
  notificationChannel: {
    [NotificationChannel.IN_APP]: 'In the app',
    [NotificationChannel.EMAIL]: 'Email',
    [NotificationChannel.SMS]: 'SMS',
    [NotificationChannel.PUSH]: 'Phone alert',
    [NotificationChannel.WHATSAPP]: 'WhatsApp',
  } as Record<NotificationChannel, string>,

  notificationCategory: {
    [NotificationCategory.ORDER]: 'Orders',
    [NotificationCategory.APPROVAL]: 'Approvals',
    [NotificationCategory.FULFILMENT]: 'Picking and packing',
    [NotificationCategory.DELIVERY]: 'Deliveries',
    [NotificationCategory.FINANCE]: 'Money',
    [NotificationCategory.INVENTORY]: 'Stock',
    [NotificationCategory.SECURITY]: 'Security',
    [NotificationCategory.SYSTEM]: 'System',
  } as Record<NotificationCategory, string>,

  /**
   * `Record<ReturnReason, string>`, so a new reason in the shared types fails
   * the build here rather than reaching a shop owner as `COLD_CHAIN_BREACH`.
   */
  returnReason: {
    [ReturnReason.DAMAGED_IN_TRANSIT]: 'Damaged on the way',
    [ReturnReason.EXPIRED]: 'Past its expiry date',
    [ReturnReason.NEAR_EXPIRY]: 'Too close to its expiry date',
    [ReturnReason.WRONG_ITEM]: 'The wrong item was sent',
    [ReturnReason.EXCESS_QUANTITY]: 'More was sent than ordered',
    [ReturnReason.QUALITY_COMPLAINT]: 'Something is wrong with it',
    [ReturnReason.COLD_CHAIN_BREACH]: 'It was not kept cold',
    [ReturnReason.ORDER_ERROR]: 'We ordered it by mistake',
    [ReturnReason.OTHER]: 'Something else',
  } as Record<ReturnReason, string>,

  /**
   * `Record<PaymentMethod, string>` for the same reason the status maps are:
   * a new method added to the shared types fails the build here until it has
   * words. `Checkout.tsx` rendered these with `replaceAll('_', ' ')`, which
   * gave a shop owner "MOBILE FINANCIAL SERVICE" to choose from.
   */
  paymentMethod: {
    [PaymentMethod.CASH]: 'Cash',
    [PaymentMethod.BANK_TRANSFER]: 'Bank transfer',
    [PaymentMethod.MOBILE_FINANCIAL_SERVICE]: 'bKash, Nagad or similar',
    [PaymentMethod.CHEQUE]: 'Cheque',
    [PaymentMethod.CREDIT]: 'On account',
    [PaymentMethod.ADVANCE_BALANCE]: 'From money already paid',
    [PaymentMethod.OTHER]: 'Something else',
  } as Record<PaymentMethod, string>,

  nav: {
    sections: 'Sections',
    goTo: 'Go to…',
    myAccount: 'My account',
    appearance: 'Appearance',
    language: 'Language',
    light: 'Light',
    dark: 'Dark',
    system: 'Follow my device',
    skipToContent: 'Skip to the main content',
  },

  roles: {
    [UserRole.SUPER_ADMIN]: 'Super administrator',
    [UserRole.ADMIN]: 'Administrator',
    [UserRole.MANAGER]: 'Manager',
    [UserRole.STOREKEEPER]: 'Storekeeper',
    [UserRole.DELIVERY_PERSON]: 'Delivery person',
    [UserRole.SHOP_OWNER]: 'Shop owner',
  } as Record<UserRole, string>,

  orderStatus: {
    [OrderStatus.DRAFT]: 'Draft',
    [OrderStatus.SUBMITTED]: 'Awaiting approval',
    [OrderStatus.UNDER_REVIEW]: 'Being reviewed',
    [OrderStatus.ON_HOLD]: 'On hold',
    [OrderStatus.APPROVED]: 'Approved',
    [OrderStatus.PARTIALLY_APPROVED]: 'Partly approved',
    [OrderStatus.REJECTED]: 'Rejected',
    [OrderStatus.PREPARING]: 'Being picked',
    [OrderStatus.PACKING]: 'Being packed',
    [OrderStatus.PACKED]: 'Packed',
    [OrderStatus.INVOICE_GENERATED]: 'Invoice ready',
    [OrderStatus.READY_FOR_DELIVERY]: 'Ready for delivery',
    [OrderStatus.DELIVERY_ASSIGNED]: 'Rider assigned',
    [OrderStatus.HANDED_TO_DELIVERY]: 'With the rider',
    [OrderStatus.PICKED_UP]: 'Collected from store',
    [OrderStatus.OUT_FOR_DELIVERY]: 'On the way',
    [OrderStatus.DELIVERED]: 'Delivered',
    [OrderStatus.PARTIALLY_DELIVERED]: 'Partly delivered',
    [OrderStatus.DELIVERY_FAILED]: 'Delivery failed',
    [OrderStatus.CANCELLED]: 'Cancelled',
    [OrderStatus.RETURN_REQUESTED]: 'Return requested',
    [OrderStatus.RETURNED]: 'Returned',
  } as Record<OrderStatus, string>,

  deliveryStatus: {
    [DeliveryStatus.READY_FOR_ASSIGNMENT]: 'Needs a rider',
    [DeliveryStatus.ASSIGNED]: 'Rider assigned',
    [DeliveryStatus.HANDED_OVER]: 'Handed to rider',
    [DeliveryStatus.PICKED_UP]: 'Collected',
    [DeliveryStatus.OUT_FOR_DELIVERY]: 'On the way',
    [DeliveryStatus.ARRIVED]: 'At the shop',
    [DeliveryStatus.DELIVERED]: 'Delivered',
    [DeliveryStatus.PARTIALLY_DELIVERED]: 'Partly delivered',
    [DeliveryStatus.FAILED]: 'Failed',
    [DeliveryStatus.RETURNING]: 'Coming back',
    [DeliveryStatus.RETURNED_TO_STORE]: 'Back at the store',
    [DeliveryStatus.CANCELLED]: 'Cancelled',
  } as Record<DeliveryStatus, string>,

  paymentStatus: {
    [PaymentStatus.PENDING]: 'Not yet posted',
    [PaymentStatus.POSTED]: 'Posted',
    [PaymentStatus.FAILED]: 'Failed',
    [PaymentStatus.REVERSED]: 'Reversed',
  } as Record<PaymentStatus, string>,

  returnStatus: {
    [ReturnStatus.REQUESTED]: 'Requested',
    [ReturnStatus.UNDER_REVIEW]: 'Being reviewed',
    [ReturnStatus.APPROVED]: 'Approved',
    [ReturnStatus.PARTIALLY_APPROVED]: 'Partly approved',
    [ReturnStatus.REJECTED]: 'Rejected',
    [ReturnStatus.COLLECTED]: 'Collected',
    [ReturnStatus.RECEIVED]: 'Received',
    [ReturnStatus.COMPLETED]: 'Completed',
    [ReturnStatus.CANCELLED]: 'Cancelled',
  } as Record<ReturnStatus, string>,

  shopStatus: {
    [ShopStatus.PENDING]: 'Awaiting approval',
    [ShopStatus.ACTIVE]: 'Active',
    [ShopStatus.INACTIVE]: 'Inactive',
    [ShopStatus.SUSPENDED]: 'Suspended',
    [ShopStatus.CREDIT_BLOCKED]: 'Credit blocked',
    [ShopStatus.LICENCE_EXPIRED]: 'Licence expired',
  } as Record<ShopStatus, string>,

  /**
   * Server error codes, in words the person reading them can act on.
   *
   * These were rendered verbatim: a shop owner whose order exceeded their limit
   * was shown `CREDIT_LIMIT_EXCEEDED`. Each of these says what happened and what
   * to do about it, because an error a user cannot act on is a support call.
   */
  errors: {
    UNAUTHORIZED: 'You have been signed out. Sign in again to carry on.',
    FORBIDDEN: 'Your account does not have permission to do that.',
    NOT_FOUND: 'That could not be found. It may have been removed.',
    RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
    VALIDATION_ERROR: 'Some of what was entered is not valid. Check the highlighted fields.',
    CREDIT_LIMIT: 'This order would take the shop past its credit limit.',
    CREDIT_BLOCKED: 'This shop’s account is blocked, so new orders cannot be approved.',
    CREDIT_OVERRIDE_FORBIDDEN:
      'Only an administrator can approve an order past its credit limit. Ask one to review it.',
    CREDIT_OVERRIDE_REASON_REQUIRED: 'Write down why this order is being approved anyway.',
    INSUFFICIENT_STOCK: 'There is not enough stock on the shelf for this quantity.',
    STALE_ORDER: 'Somebody else changed this order while you were looking at it. It has reloaded.',
    STALE_VERSION: 'Somebody else changed this while you were looking at it. It has reloaded.',
    STALE_RETURN: 'Somebody else updated this return while you were looking at it.',
    CONCURRENT_STOCK_CHANGE: 'The stock changed while this was being saved. Try again.',
    CANCELLATION_NOT_ALLOWED:
      'This order has gone too far to cancel. Raise a return instead, so the invoice is credited and the goods come back.',
    NO_CANCELLATION_REQUEST: 'Nobody has asked for this order to be cancelled.',
    PASSWORD_CHANGE_REQUIRED: 'Choose a new password before carrying on.',
    CURRENT_PASSWORD_INCORRECT: 'That is not your current password.',
    PASSWORD_TOO_SHORT: 'That password is too short.',
    PASSWORD_UNCHANGED: 'Choose a password you have not just been using.',
    LICENCE_EXPIRED: 'This shop’s drug licence has expired, so orders cannot be approved.',
    SHOP_BLOCKED: 'This shop’s account is not active.',
    DUPLICATE_ITEM: 'The same medicine appears twice in this order.',
    QUANTITY_INVALID: 'That quantity is outside the limits set for this medicine.',
    MEDICINE_UNAVAILABLE: 'One of the medicines in this order is no longer available.',
    UNKNOWN: 'Something went wrong. Try again, and tell support if it keeps happening.',
  } as Record<string, string>,
  /*
   * No `as const`. It would make every value a *literal* type, so `bn.ts`
   * typed against this could only satisfy it by repeating the English words —
   * the compiler would demand 'Loading', not 'লোড হচ্ছে'. The property names
   * are still fixed by the object literal, which is the guarantee that matters:
   * a key added here and forgotten in Bangla is still a compile error.
   */
};

export type Catalogue = typeof en;
