import {
  OrderStatus,
  DeliveryStatus,
  PaymentStatus,
  ReturnStatus,
  ShopStatus,
  UserRole,
} from '@medsupply/shared-types';
import type { Catalogue } from './en';

/**
 * বাংলা — the Bangla catalogue.
 *
 * Typed `Catalogue`, so a key present in English and missing here, or the
 * reverse, is a **compile error**. A catalogue that can silently fall back is a
 * catalogue that half-translates a screen and nobody notices which half.
 *
 * **Numbers stay in Western digits, and that is a deliberate decision rather
 * than an omission.** Switching the locale to `bn-BD` would change three things
 * at once — Bengali digits, lakh/crore grouping, and a suffixed ৳ — so every
 * invoice total would silently restyle in three ways at the moment somebody
 * changed language. Money here is reconciled against printed invoices, bank
 * slips and bKash/Nagad messages, all of which use Western digits; a stock
 * count keyed as `120` and displayed as `১২০` cannot be pasted or searched;
 * and both money parsers accept only `[0-9]`, so Bengali display without
 * Bengali input would produce a form that refuses what it just showed you.
 *
 * Words are translated. Numbers, references and dates-as-digits are not.
 */
export const bn: Catalogue = {
  common: {
    appName: 'MedSupply B2B',
    loading: 'লোড হচ্ছে',
    retry: 'আবার চেষ্টা করুন',
    cancel: 'বাতিল',
    save: 'সংরক্ষণ',
    close: 'বন্ধ',
    search: 'খুঁজুন',
    goHome: 'হোম স্ক্রিনে যান',
    signIn: 'সাইন ইন',
    signOut: 'সাইন আউট',
    somethingWentWrong: 'কিছু একটা ভুল হয়েছে',
    nothingHere: 'এখানে এখনও কিছু নেই',
    reference: 'রেফারেন্স',
    quoteReference: 'সহায়তার জন্য যোগাযোগ করলে এই রেফারেন্সটি জানাবেন',
  },

  auth: {
    signInTitle: 'আপনার অ্যাকাউন্টে সাইন ইন করুন',
    email: 'ইমেইল ঠিকানা',
    password: 'পাসওয়ার্ড',
    signingIn: 'সাইন ইন করা হচ্ছে…',
    invalidCredentials: 'এই ইমেইল ও পাসওয়ার্ড কোনও অ্যাকাউন্টের সঙ্গে মেলে না।',
    changePassword: 'পাসওয়ার্ড পরিবর্তন করুন',
    currentPassword: 'আপনার বর্তমান পাসওয়ার্ড',
    newPassword: 'নতুন পাসওয়ার্ড',
    repeatPassword: 'নতুন পাসওয়ার্ড আবার লিখুন',
    passwordsDoNotMatch: 'দুটি এক নয়।',
    passwordTooShort: 'অন্তত {{minimum}} অক্ষর ব্যবহার করুন।',
    mustChangeTitle: 'নিজের পাসওয়ার্ড বেছে নিন',
    mustChangeBody:
      'এই পাসওয়ার্ডটি অন্য কেউ ঠিক করে দিয়েছেন, তাই এটি একাধিক ব্যক্তির জানা। এগিয়ে যাওয়ার আগে শুধু আপনার জানা একটি পাসওয়ার্ড বেছে নিন।',
  },

  nav: {
    sections: 'বিভাগ',
    goTo: 'যেখানে যেতে চান…',
    myAccount: 'আমার অ্যাকাউন্ট',
    appearance: 'চেহারা',
    language: 'ভাষা',
    light: 'উজ্জ্বল',
    dark: 'অন্ধকার',
    system: 'আমার ডিভাইস অনুযায়ী',
    skipToContent: 'মূল অংশে যান',
  },

  roles: {
    [UserRole.SUPER_ADMIN]: 'প্রধান প্রশাসক',
    [UserRole.ADMIN]: 'প্রশাসক',
    [UserRole.MANAGER]: 'ম্যানেজার',
    [UserRole.STOREKEEPER]: 'স্টোরকিপার',
    [UserRole.DELIVERY_PERSON]: 'ডেলিভারি কর্মী',
    [UserRole.SHOP_OWNER]: 'দোকান মালিক',
  },

  orderStatus: {
    [OrderStatus.DRAFT]: 'খসড়া',
    [OrderStatus.SUBMITTED]: 'অনুমোদনের অপেক্ষায়',
    [OrderStatus.UNDER_REVIEW]: 'পর্যালোচনা চলছে',
    [OrderStatus.ON_HOLD]: 'স্থগিত',
    [OrderStatus.APPROVED]: 'অনুমোদিত',
    [OrderStatus.PARTIALLY_APPROVED]: 'আংশিক অনুমোদিত',
    [OrderStatus.REJECTED]: 'প্রত্যাখ্যাত',
    [OrderStatus.PREPARING]: 'সংগ্রহ চলছে',
    [OrderStatus.PACKING]: 'প্যাকিং চলছে',
    [OrderStatus.PACKED]: 'প্যাক করা হয়েছে',
    [OrderStatus.INVOICE_GENERATED]: 'চালান প্রস্তুত',
    [OrderStatus.READY_FOR_DELIVERY]: 'ডেলিভারির জন্য প্রস্তুত',
    [OrderStatus.DELIVERY_ASSIGNED]: 'ডেলিভারি কর্মী নির্ধারিত',
    [OrderStatus.HANDED_TO_DELIVERY]: 'ডেলিভারি কর্মীর কাছে',
    [OrderStatus.PICKED_UP]: 'স্টোর থেকে সংগ্রহ করা হয়েছে',
    [OrderStatus.OUT_FOR_DELIVERY]: 'পথে আছে',
    [OrderStatus.DELIVERED]: 'পৌঁছে দেওয়া হয়েছে',
    [OrderStatus.PARTIALLY_DELIVERED]: 'আংশিক পৌঁছেছে',
    [OrderStatus.DELIVERY_FAILED]: 'ডেলিভারি ব্যর্থ',
    [OrderStatus.CANCELLED]: 'বাতিল',
    [OrderStatus.RETURN_REQUESTED]: 'ফেরত চাওয়া হয়েছে',
    [OrderStatus.RETURNED]: 'ফেরত এসেছে',
  },

  deliveryStatus: {
    [DeliveryStatus.READY_FOR_ASSIGNMENT]: 'কর্মী প্রয়োজন',
    [DeliveryStatus.ASSIGNED]: 'কর্মী নির্ধারিত',
    [DeliveryStatus.HANDED_OVER]: 'কর্মীকে দেওয়া হয়েছে',
    [DeliveryStatus.PICKED_UP]: 'সংগ্রহ করা হয়েছে',
    [DeliveryStatus.OUT_FOR_DELIVERY]: 'পথে আছে',
    [DeliveryStatus.ARRIVED]: 'দোকানে পৌঁছেছে',
    [DeliveryStatus.DELIVERED]: 'পৌঁছে দেওয়া হয়েছে',
    [DeliveryStatus.PARTIALLY_DELIVERED]: 'আংশিক পৌঁছেছে',
    [DeliveryStatus.FAILED]: 'ব্যর্থ',
    [DeliveryStatus.RETURNING]: 'ফিরে আসছে',
    [DeliveryStatus.RETURNED_TO_STORE]: 'স্টোরে ফিরেছে',
    [DeliveryStatus.CANCELLED]: 'বাতিল',
  },

  paymentStatus: {
    [PaymentStatus.PENDING]: 'এখনও হিসাবে ওঠেনি',
    [PaymentStatus.POSTED]: 'হিসাবে উঠেছে',
    [PaymentStatus.FAILED]: 'ব্যর্থ',
    [PaymentStatus.REVERSED]: 'বাতিল করা হয়েছে',
  },

  returnStatus: {
    [ReturnStatus.REQUESTED]: 'অনুরোধ করা হয়েছে',
    [ReturnStatus.UNDER_REVIEW]: 'পর্যালোচনা চলছে',
    [ReturnStatus.APPROVED]: 'অনুমোদিত',
    [ReturnStatus.PARTIALLY_APPROVED]: 'আংশিক অনুমোদিত',
    [ReturnStatus.REJECTED]: 'প্রত্যাখ্যাত',
    [ReturnStatus.COLLECTED]: 'সংগ্রহ করা হয়েছে',
    [ReturnStatus.RECEIVED]: 'গ্রহণ করা হয়েছে',
    [ReturnStatus.COMPLETED]: 'সম্পন্ন',
    [ReturnStatus.CANCELLED]: 'বাতিল',
  },

  shopStatus: {
    [ShopStatus.PENDING]: 'অনুমোদনের অপেক্ষায়',
    [ShopStatus.ACTIVE]: 'সক্রিয়',
    [ShopStatus.INACTIVE]: 'নিষ্ক্রিয়',
    [ShopStatus.SUSPENDED]: 'স্থগিত',
    [ShopStatus.CREDIT_BLOCKED]: 'বাকি বন্ধ',
    [ShopStatus.LICENCE_EXPIRED]: 'লাইসেন্সের মেয়াদ শেষ',
  },

  errors: {
    UNAUTHORIZED: 'আপনাকে সাইন আউট করা হয়েছে। চালিয়ে যেতে আবার সাইন ইন করুন।',
    FORBIDDEN: 'এই কাজটি করার অনুমতি আপনার অ্যাকাউন্টে নেই।',
    NOT_FOUND: 'এটি খুঁজে পাওয়া যায়নি। হয়তো সরিয়ে ফেলা হয়েছে।',
    RATE_LIMITED: 'অনেকবার চেষ্টা হয়েছে। এক মিনিট পরে আবার চেষ্টা করুন।',
    VALIDATION_ERROR: 'কিছু তথ্য ঠিক নেই। চিহ্নিত ঘরগুলো দেখুন।',
    CREDIT_LIMIT: 'এই অর্ডারে দোকানের বাকির সীমা পেরিয়ে যাবে।',
    CREDIT_BLOCKED: 'এই দোকানের বাকি বন্ধ, তাই নতুন অর্ডার অনুমোদন করা যাবে না।',
    CREDIT_OVERRIDE_FORBIDDEN:
      'বাকির সীমা পেরিয়ে অর্ডার অনুমোদন কেবল প্রশাসক করতে পারেন। একজন প্রশাসককে দেখতে বলুন।',
    CREDIT_OVERRIDE_REASON_REQUIRED: 'কেন তবুও অনুমোদন করা হচ্ছে, তা লিখুন।',
    INSUFFICIENT_STOCK: 'এই পরিমাণের জন্য স্টকে যথেষ্ট পণ্য নেই।',
    STALE_ORDER: 'আপনি দেখার সময় অন্য কেউ এই অর্ডারটি বদলেছেন। পাতাটি আবার লোড হয়েছে।',
    STALE_VERSION: 'আপনি দেখার সময় অন্য কেউ এটি বদলেছেন। পাতাটি আবার লোড হয়েছে।',
    STALE_RETURN: 'আপনি দেখার সময় অন্য কেউ এই ফেরতটি বদলেছেন।',
    CONCURRENT_STOCK_CHANGE: 'সংরক্ষণের সময় স্টক বদলে গেছে। আবার চেষ্টা করুন।',
    CANCELLATION_NOT_ALLOWED:
      'এই অর্ডারটি বাতিল করার সময় পেরিয়ে গেছে। বদলে ফেরত দিন — তাতে চালানে টাকা ফেরত যাবে এবং পণ্য ফিরে আসবে।',
    NO_CANCELLATION_REQUEST: 'এই অর্ডার বাতিলের কোনও অনুরোধ কেউ করেননি।',
    PASSWORD_CHANGE_REQUIRED: 'এগিয়ে যাওয়ার আগে নতুন পাসওয়ার্ড বেছে নিন।',
    CURRENT_PASSWORD_INCORRECT: 'এটি আপনার বর্তমান পাসওয়ার্ড নয়।',
    PASSWORD_TOO_SHORT: 'পাসওয়ার্ডটি খুব ছোট।',
    PASSWORD_UNCHANGED: 'এইমাত্র ব্যবহার করেননি এমন একটি পাসওয়ার্ড বেছে নিন।',
    LICENCE_EXPIRED: 'এই দোকানের ড্রাগ লাইসেন্সের মেয়াদ শেষ, তাই অর্ডার অনুমোদন করা যাবে না।',
    SHOP_BLOCKED: 'এই দোকানের অ্যাকাউন্ট সক্রিয় নয়।',
    DUPLICATE_ITEM: 'একই ওষুধ এই অর্ডারে দুইবার আছে।',
    QUANTITY_INVALID: 'এই ওষুধের জন্য নির্ধারিত সীমার বাইরে পরিমাণ দেওয়া হয়েছে।',
    MEDICINE_UNAVAILABLE: 'এই অর্ডারের একটি ওষুধ আর পাওয়া যাচ্ছে না।',
    UNKNOWN: 'কিছু একটা ভুল হয়েছে। আবার চেষ্টা করুন, বারবার হলে সহায়তাকে জানান।',
  },
};
