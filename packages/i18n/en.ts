import {
  OrderStatus,
  DeliveryStatus,
  PaymentStatus,
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
