export const ShopStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
  CREDIT_BLOCKED: 'CREDIT_BLOCKED',
  LICENCE_EXPIRED: 'LICENCE_EXPIRED',
} as const;
export type ShopStatus = (typeof ShopStatus)[keyof typeof ShopStatus];

export interface Address {
  label: string;
  line1: string;
  line2?: string;
  city: string;
  district: string;
  postalCode?: string;
  isDefault: boolean;
}

export interface Shop {
  _id: string;
  reference: string;
  name: string;
  ownerIds: string[];
  managerId?: string;
  primaryPhone: string;
  alternativePhone?: string;
  email?: string;
  territory?: string;
  billingAddress?: Address;
  deliveryAddresses: Address[];
  drugLicenceNumber?: string;
  drugLicenceIssueDate?: Date;
  drugLicenceExpiryDate?: Date;
  tradeLicenceNumber?: string;
  creditLimit: number;
  outstandingBalance: number;
  reservedCreditMinor?: number;
  paymentTermsDays: number;
  defaultDiscount: number;
  status: ShopStatus;
  orderBlockingReason?: string;
  notes?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const UserRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  STOREKEEPER: 'STOREKEEPER',
  DELIVERY_PERSON: 'DELIVERY_PERSON',
  SHOP_OWNER: 'SHOP_OWNER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export interface User {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Optional contact number used by the SMS and WhatsApp notification channels. */
  phone?: string;
  role: UserRole;
  status: UserStatus;
  forcePasswordChange?: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

export const MedicineClassification = { PRESCRIPTION: 'PRESCRIPTION', OTC: 'OTC' } as const;
export type MedicineClassification =
  (typeof MedicineClassification)[keyof typeof MedicineClassification];

export const StockMovementType = {
  RECEIPT: 'RECEIPT',
  ADDITION: 'ADDITION',
  ADJUSTMENT: 'ADJUSTMENT',
  DAMAGE: 'DAMAGE',
  EXPIRY: 'EXPIRY',
  QUARANTINE: 'QUARANTINE',
  QUARANTINE_RELEASE: 'QUARANTINE_RELEASE',
  RESERVATION: 'RESERVATION',
  RESERVATION_RELEASE: 'RESERVATION_RELEASE',
  PICKING: 'PICKING',
  PICKING_RETURN: 'PICKING_RETURN',
  PACKING: 'PACKING',
  PACKING_REVERSAL: 'PACKING_REVERSAL',
  RETURN_RECEIPT: 'RETURN_RECEIPT',
  RETURN_RESTOCK: 'RETURN_RESTOCK',
  RETURN_DAMAGED: 'RETURN_DAMAGED',
  RETURN_EXPIRED: 'RETURN_EXPIRED',
  RETURN_QUARANTINED: 'RETURN_QUARANTINED',
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];

/**
 * Movement types a customer return produces. `RETURN_RECEIPT` books the goods
 * into the `returned` bucket; the others move them out of it once inspected, so
 * returned stock is never sellable before somebody has looked at it.
 */
export const RETURN_STOCK_MOVEMENTS: StockMovementType[] = [
  StockMovementType.RETURN_RECEIPT,
  StockMovementType.RETURN_RESTOCK,
  StockMovementType.RETURN_DAMAGED,
  StockMovementType.RETURN_EXPIRED,
  StockMovementType.RETURN_QUARANTINED,
];

export interface StockQuantities {
  onHand: number;
  available: number;
  reserved: number;
  picking: number;
  packed: number;
  damaged: number;
  expired: number;
  returned: number;
  quarantined: number;
}

export interface Medicine {
  _id: string;
  reference: string;
  sku: string;
  barcode?: string;
  brandName: string;
  genericName: string;
  manufacturer: string;
  strength: string;
  dosageForm: string;
  packSize: string;
  unit: string;
  category: string;
  description?: string;
  productImageUrl?: string;
  costPriceMinor: number;
  defaultSellingPriceMinor: number;
  minimumOrderQuantity: number;
  maximumOrderQuantity?: number;
  classification: MedicineClassification;
  coldChain: boolean;
  isActive: boolean;
  totalAvailable?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MedicineBatch {
  _id: string;
  medicineId: string | Medicine;
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  costPriceMinor: number;
  sellingPriceOverrideMinor?: number;
  receivedQuantity: number;
  quantities: StockQuantities;
  warehouseLocation: string;
  isBlocked: boolean;
  isQuarantined: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export const OrderStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  ON_HOLD: 'ON_HOLD',
  APPROVED: 'APPROVED',
  PARTIALLY_APPROVED: 'PARTIALLY_APPROVED',
  REJECTED: 'REJECTED',
  PREPARING: 'PREPARING',
  PACKING: 'PACKING',
  PACKED: 'PACKED',
  INVOICE_GENERATED: 'INVOICE_GENERATED',
  READY_FOR_DELIVERY: 'READY_FOR_DELIVERY',
  DELIVERY_ASSIGNED: 'DELIVERY_ASSIGNED',
  HANDED_TO_DELIVERY: 'HANDED_TO_DELIVERY',
  PICKED_UP: 'PICKED_UP',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  PARTIALLY_DELIVERED: 'PARTIALLY_DELIVERED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  CANCELLED: 'CANCELLED',
  RETURN_REQUESTED: 'RETURN_REQUESTED',
  RETURNED: 'RETURNED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentMethod = {
  CASH: 'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
  MOBILE_FINANCIAL_SERVICE: 'MOBILE_FINANCIAL_SERVICE',
  CHEQUE: 'CHEQUE',
  CREDIT: 'CREDIT',
  ADVANCE_BALANCE: 'ADVANCE_BALANCE',
  OTHER: 'OTHER',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  PENDING: 'PENDING',
  POSTED: 'POSTED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentSource = {
  MANUAL: 'MANUAL',
  DELIVERY_COLLECTION: 'DELIVERY_COLLECTION',
} as const;
export type PaymentSource = (typeof PaymentSource)[keyof typeof PaymentSource];

export const CollectionHandoverStatus = {
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING: 'PENDING',
  HANDED_OVER: 'HANDED_OVER',
} as const;
export type CollectionHandoverStatus =
  (typeof CollectionHandoverStatus)[keyof typeof CollectionHandoverStatus];

export const LedgerTransactionType = {
  OPENING_BALANCE: 'OPENING_BALANCE',
  INVOICE_CHARGE: 'INVOICE_CHARGE',
  PAYMENT: 'PAYMENT',
  CREDIT_ADJUSTMENT: 'CREDIT_ADJUSTMENT',
  DEBIT_ADJUSTMENT: 'DEBIT_ADJUSTMENT',
  PAYMENT_REVERSAL: 'PAYMENT_REVERSAL',
  RETURN_CREDIT: 'RETURN_CREDIT',
} as const;
export type LedgerTransactionType =
  (typeof LedgerTransactionType)[keyof typeof LedgerTransactionType];

export const LedgerAccount = {
  ACCOUNTS_RECEIVABLE: 'ACCOUNTS_RECEIVABLE',
  SALES: 'SALES',
  CASH_UNDEPOSITED: 'CASH_UNDEPOSITED',
  BANK_CLEARING: 'BANK_CLEARING',
  CUSTOMER_ADVANCE: 'CUSTOMER_ADVANCE',
  ADJUSTMENTS: 'ADJUSTMENTS',
  RETURNS: 'RETURNS',
} as const;
export type LedgerAccount = (typeof LedgerAccount)[keyof typeof LedgerAccount];

export interface Payment {
  _id: string;
  reference: string;
  shopId: string | Shop;
  invoiceId?: string | { _id: string; reference: string; grandTotalMinor: number };
  deliveryId?: string | { _id: string; reference: string };
  amountMinor: number;
  invoiceAppliedMinor: number;
  advanceCreatedMinor: number;
  method: PaymentMethod;
  transactionReference?: string;
  source: PaymentSource;
  collectedBy?: string | User;
  receivedBy?: string | User;
  collectedAt: string;
  postedAt?: string;
  postedBy?: string | User;
  receiptReference?: string;
  status: PaymentStatus;
  notes?: string;
  attachmentId?: string;
  reversalReference?: string;
  reversalReason?: string;
  reversedAt?: string;
  reversedBy?: string | User;
  handoverStatus: CollectionHandoverStatus;
  handedOverAt?: string;
  handedOverBy?: string | User;
  idempotencyKey: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntry {
  account: LedgerAccount;
  debitMinor: number;
  creditMinor: number;
}

export interface LedgerTransaction {
  _id: string;
  reference: string;
  shopId: string | Shop;
  invoiceId?: string;
  paymentId?: string;
  deliveryId?: string;
  type: LedgerTransactionType;
  occurredAt: string;
  description: string;
  entries: LedgerEntry[];
  customerBalanceDeltaMinor: number;
  balanceAfterMinor: number;
  sourceKey: string;
  reversalOf?: string;
  createdBy: string | User;
  createdAt: string;
}

export interface CreditSummary {
  shopId: string;
  creditLimitMinor: number;
  ledgerBalanceMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  advanceBalanceMinor: number;
  availableCreditMinor: number;
  utilisationBasisPoints: number;
  paymentTermsDays: number;
  manuallyBlocked: boolean;
  limitExceeded: boolean;
  overdueBlocked: boolean;
  orderBlocked: boolean;
  blockReasons: string[];
  asOf: string;
}

export interface StatementRow {
  reference: string;
  date: string;
  type: LedgerTransactionType;
  description: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
  invoiceId?: string;
  paymentId?: string;
}

export interface AccountStatement {
  shop: { _id: string; reference: string; name: string };
  from: string;
  to: string;
  openingBalanceMinor: number;
  rows: StatementRow[];
  closingBalanceMinor: number;
}

export interface OrderItem {
  medicineId: string;
  medicineSnapshot: {
    reference: string;
    sku: string;
    brandName: string;
    genericName: string;
    manufacturer: string;
    strength: string;
    dosageForm: string;
    packSize: string;
    unit: string;
  };
  requestedQuantity: number;
  estimatedUnitPriceMinor: number;
  estimatedDiscountMinor: number;
  estimatedLineTotalMinor: number;
  availableStockSnapshot: number;
  shopNotes?: string;
}

export interface Order {
  _id: string;
  reference: string;
  shopId: string | Shop;
  submittedBy: string;
  items: OrderItem[];
  deliveryAddressSnapshot?: Address;
  contactSnapshot?: { name: string; phone: string; email?: string };
  requestedPaymentMethod?: PaymentMethod;
  purchaseOrderReference?: string;
  shopNotes?: string;
  estimatedSubtotalMinor: number;
  estimatedDiscountMinor: number;
  estimatedDeliveryChargeMinor: number;
  estimatedTotalMinor: number;
  status: OrderStatus;
  statusHistory: Array<{
    from?: OrderStatus;
    to: OrderStatus;
    actorId: string;
    at: string;
    note?: string;
  }>;
  cancellationRequestedAt?: string;
  cancellationReason?: string;
  submittedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const DeliveryStatus = {
  READY_FOR_ASSIGNMENT: 'READY_FOR_ASSIGNMENT',
  ASSIGNED: 'ASSIGNED',
  HANDED_OVER: 'HANDED_OVER',
  PICKED_UP: 'PICKED_UP',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  ARRIVED: 'ARRIVED',
  DELIVERED: 'DELIVERED',
  PARTIALLY_DELIVERED: 'PARTIALLY_DELIVERED',
  FAILED: 'FAILED',
  RETURNING: 'RETURNING',
  RETURNED_TO_STORE: 'RETURNED_TO_STORE',
  CANCELLED: 'CANCELLED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const DeliveryPriority = { NORMAL: 'NORMAL', HIGH: 'HIGH', URGENT: 'URGENT' } as const;
export type DeliveryPriority = (typeof DeliveryPriority)[keyof typeof DeliveryPriority];

export const DeliveryFailureReason = {
  SHOP_CLOSED: 'SHOP_CLOSED',
  CUSTOMER_UNAVAILABLE: 'CUSTOMER_UNAVAILABLE',
  ADDRESS_NOT_FOUND: 'ADDRESS_NOT_FOUND',
  CUSTOMER_REJECTED: 'CUSTOMER_REJECTED',
  PAYMENT_UNAVAILABLE: 'PAYMENT_UNAVAILABLE',
  PACKAGE_ISSUE: 'PACKAGE_ISSUE',
  VEHICLE_ISSUE: 'VEHICLE_ISSUE',
  OTHER: 'OTHER',
} as const;
export type DeliveryFailureReason =
  (typeof DeliveryFailureReason)[keyof typeof DeliveryFailureReason];

export const DeliveryProofType = {
  OTP: 'OTP',
  SIGNATURE: 'SIGNATURE',
  PHOTOGRAPH: 'PHOTOGRAPH',
  GPS: 'GPS',
} as const;
export type DeliveryProofType = (typeof DeliveryProofType)[keyof typeof DeliveryProofType];

export interface Delivery {
  _id: string;
  reference: string;
  orderId: string | Order;
  packageId: string | { _id: string; reference: string; barcode: string; packageCount: number };
  invoiceId:
    string | { _id: string; reference: string; grandTotalMinor: number; amountDueMinor: number };
  shopId: string | Shop;
  addressSnapshot: Address;
  contactSnapshot: { name: string; phone: string; email?: string };
  status: DeliveryStatus;
  priority: DeliveryPriority;
  assignedTo?: string | User;
  assignedBy?: string;
  assignedAt?: string;
  expectedDeliveryDate?: string;
  instructions?: string;
  proofRequirements: DeliveryProofType[];
  handover?: {
    confirmedBy: string;
    confirmedAt: string;
    packageReference: string;
    invoiceReference: string;
    packageCount: number;
    acknowledgedBy?: string;
    acknowledgedAt?: string;
  };
  proof?: {
    receiverName: string;
    receiverPhone: string;
    otpVerifiedAt?: string;
    signatureFileId?: string;
    photoFileId?: string;
    gps?: { latitude: number; longitude: number; accuracyMetres?: number; capturedAt: string };
    notes?: string;
    deliveredPackageCount: number;
    deliveredAt: string;
  };
  paymentCollection?: {
    amountMinor: number;
    method?: Exclude<PaymentMethod, 'CREDIT' | 'ADVANCE_BALANCE'> | 'MOBILE_BANKING';
    transactionReference?: string;
    status: 'NO_COLLECTION' | 'PENDING_POSTING' | 'POSTED' | 'FAILED' | 'REVERSED';
    paymentId?: string;
    paymentReference?: string;
  };
  failure?: {
    reason: DeliveryFailureReason;
    notes: string;
    reportedBy: string;
    reportedAt: string;
  };
  history: Array<{
    from?: DeliveryStatus;
    to: DeliveryStatus;
    actorId: string;
    actorRole: UserRole;
    at: string;
    note?: string;
  }>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/* Phase 9 — Notifications, real-time updates and activity timeline */

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PUSH: 'PUSH',
  WHATSAPP: 'WHATSAPP',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

/** IN_APP is the durable record of a notification and is never opt-out. */
export const OPTIONAL_NOTIFICATION_CHANNELS: NotificationChannel[] = [
  NotificationChannel.EMAIL,
  NotificationChannel.SMS,
  NotificationChannel.PUSH,
  NotificationChannel.WHATSAPP,
];

export const NotificationCategory = {
  ORDER: 'ORDER',
  APPROVAL: 'APPROVAL',
  FULFILMENT: 'FULFILMENT',
  DELIVERY: 'DELIVERY',
  FINANCE: 'FINANCE',
  INVENTORY: 'INVENTORY',
  SECURITY: 'SECURITY',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationCategory = (typeof NotificationCategory)[keyof typeof NotificationCategory];

export const NotificationPriority = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type NotificationPriority = (typeof NotificationPriority)[keyof typeof NotificationPriority];

/**
 * Closed notification event catalogue. Every string here is also the historical
 * `type` written by Phases 4-8, so existing notification records stay readable.
 */
export const NotificationEvent = {
  ORDER_SUBMITTED: 'ORDER_SUBMITTED',
  ORDER_UNDER_REVIEW: 'ORDER_UNDER_REVIEW',
  ORDER_ON_HOLD: 'ORDER_ON_HOLD',
  ORDER_REJECTED: 'ORDER_REJECTED',
  ORDER_APPROVED: 'ORDER_APPROVED',
  /**
   * A shop owner has *asked* to cancel. Separate from ORDER_CANCELLED because
   * the request endpoint used to fire that one, telling management an order was
   * cancelled when nothing had cancelled it.
   */
  ORDER_CANCELLATION_REQUESTED: 'ORDER_CANCELLATION_REQUESTED',
  ORDER_CANCELLATION_REFUSED: 'ORDER_CANCELLATION_REFUSED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  PICKING_READY: 'PICKING_READY',
  PICKING_DISCREPANCY: 'PICKING_DISCREPANCY',
  PICKING_DISCREPANCY_RESOLVED: 'PICKING_DISCREPANCY_RESOLVED',
  PACKING_SHORTFALL: 'PACKING_SHORTFALL',
  INVOICE_ISSUED: 'INVOICE_ISSUED',
  DELIVERY_ASSIGNED: 'DELIVERY_ASSIGNED',
  DELIVERY_HANDED_OVER: 'DELIVERY_HANDED_OVER',
  DELIVERY_PICKED_UP: 'DELIVERY_PICKED_UP',
  DELIVERY_OUT_FOR_DELIVERY: 'DELIVERY_OUT_FOR_DELIVERY',
  DELIVERY_COMPLETED: 'DELIVERY_COMPLETED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  DELIVERY_RETURNED: 'DELIVERY_RETURNED',
  DELIVERY_OTP: 'DELIVERY_OTP',
  PAYMENT_RECORDED: 'PAYMENT_RECORDED',
  PAYMENT_POSTED: 'PAYMENT_POSTED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_REVERSED: 'PAYMENT_REVERSED',
  CREDIT_BLOCKED: 'CREDIT_BLOCKED',
  INVOICE_OVERDUE: 'INVOICE_OVERDUE',
  STOCK_NEAR_EXPIRY: 'STOCK_NEAR_EXPIRY',
  RETURN_REQUESTED: 'RETURN_REQUESTED',
  RETURN_APPROVED: 'RETURN_APPROVED',
  RETURN_REJECTED: 'RETURN_REJECTED',
  RETURN_COLLECTED: 'RETURN_COLLECTED',
  RETURN_RECEIVED: 'RETURN_RECEIVED',
  CREDIT_NOTE_ISSUED: 'CREDIT_NOTE_ISSUED',
} as const;
export type NotificationEvent = (typeof NotificationEvent)[keyof typeof NotificationEvent];

export const NotificationDeliveryStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SUPPRESSED: 'SUPPRESSED',
} as const;
export type NotificationDeliveryStatus =
  (typeof NotificationDeliveryStatus)[keyof typeof NotificationDeliveryStatus];

export interface NotificationRecord {
  _id: string;
  recipientId: string;
  event: NotificationEvent;
  /** Retained for records written before Phase 9; equals `event` for new records. */
  type: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  /** Client route for the primary action, e.g. `/orders/<id>`. */
  link?: string;
  metadata?: Record<string, string | number | boolean>;
  readAt?: string;
  archivedAt?: string;
  correlationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationChannelPreference {
  event: NotificationEvent;
  channels: NotificationChannel[];
}

export interface QuietHours {
  enabled: boolean;
  /** Inclusive local start in Asia/Dhaka, `HH:mm`. */
  start: string;
  /** Exclusive local end in Asia/Dhaka, `HH:mm`. May wrap past midnight. */
  end: string;
}

export interface NotificationPreferenceRecord {
  _id: string;
  userId: string;
  /** Channels applied to any event without an explicit override. */
  defaultChannels: NotificationChannel[];
  overrides: NotificationChannelPreference[];
  quietHours: QuietHours;
  /** Digest of muted events; IN_APP records are still written. */
  mutedEvents: NotificationEvent[];
  createdAt: string;
  updatedAt: string;
}

export const PushPlatform = { ANDROID: 'ANDROID', IOS: 'IOS', WEB: 'WEB' } as const;
export type PushPlatform = (typeof PushPlatform)[keyof typeof PushPlatform];

export interface PushDeviceRecord {
  _id: string;
  userId: string;
  token: string;
  platform: PushPlatform;
  deviceName?: string;
  lastSeenAt: string;
  disabledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const ActivityEntityType = {
  ORDER: 'Order',
  SHOP: 'Shop',
  DELIVERY: 'Delivery',
  PAYMENT: 'Payment',
  INVOICE: 'Invoice',
  PICKING_LIST: 'PickingList',
  MEDICINE: 'Medicine',
  MEDICINE_BATCH: 'MedicineBatch',
  USER: 'User',
  RETURN: 'Return',
  CREDIT_NOTE: 'CreditNote',
} as const;
export type ActivityEntityType = (typeof ActivityEntityType)[keyof typeof ActivityEntityType];

export interface ActivityEventRecord {
  _id: string;
  action: string;
  category: NotificationCategory;
  entityType: ActivityEntityType;
  entityId: string;
  /** Cross-links so an order timeline can absorb its delivery and payment events. */
  orderId?: string;
  shopId?: string;
  actorId?: string;
  actorName?: string;
  actorRole?: UserRole;
  summary: string;
  detail?: string;
  metadata?: Record<string, string | number | boolean>;
  /** Internal roles allowed to read the event. */
  visibleToRoles: UserRole[];
  /** Whether owners of `shopId` may read the event. */
  visibleToShop: boolean;
  correlationId?: string;
  occurredAt: string;
  createdAt: string;
}

/** Socket.IO event names shared by the API, web and mobile clients. */
export const RealtimeEvent = {
  CONNECTED: 'realtime:connected',
  NOTIFICATION_CREATED: 'notification:created',
  NOTIFICATION_UPDATED: 'notification:updated',
  UNREAD_COUNT: 'notification:unread-count',
  ORDER_UPDATED: 'order:updated',
  APPROVAL_UPDATED: 'approval:updated',
  FULFILMENT_UPDATED: 'fulfilment:updated',
  DELIVERY_UPDATED: 'delivery:updated',
  PAYMENT_UPDATED: 'payment:updated',
  INVENTORY_UPDATED: 'inventory:updated',
  ACTIVITY_CREATED: 'activity:created',
  SETTINGS_UPDATED: 'settings:updated',
  RETURN_UPDATED: 'return:updated',
} as const;
export type RealtimeEvent = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

export interface RealtimeEntityUpdate {
  entityType: ActivityEntityType;
  entityId: string;
  reference?: string;
  status?: string;
  orderId?: string;
  shopId?: string;
  at: string;
}

export interface UnreadNotificationSummary {
  total: number;
  byCategory: Record<NotificationCategory, number>;
}

/* Phase 10 — System settings, configuration and administration */

export const SettingsGroup = {
  BUSINESS: 'business',
  FINANCE: 'finance',
  INVENTORY: 'inventory',
  DELIVERY: 'delivery',
  NOTIFICATIONS: 'notifications',
  LOCALISATION: 'localisation',
  SECURITY: 'security',
} as const;
export type SettingsGroup = (typeof SettingsGroup)[keyof typeof SettingsGroup];

/** Identity printed on invoices, receipts, statements and package labels. */
export interface BusinessSettings {
  name: string;
  legalName?: string;
  logoUrl?: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  tradeLicenceNumber?: string;
  drugLicenceNumber?: string;
  invoiceFooter: string;
}

export interface FinanceSettings {
  /** Integer basis points; 750 means 7.50%. */
  taxBasisPoints: number;
  defaultPaymentTermsDays: number;
  creditBlockOnLimitExceeded: boolean;
  creditBlockOverdueThresholdMinor: number;
  creditOverdueGraceDays: number;
  customerAdvanceEnabled: boolean;
  deliveryCollectionRequiresVerification: boolean;
}

export interface InventorySettings {
  nearExpiryDays: number;
  lowStockThreshold: number;
}

export interface DeliverySettings {
  requiredProofs: DeliveryProofType[];
  otpExpiryMinutes: number;
}

export interface NotificationSettings {
  /** Applied to users who have saved no quiet hours of their own. */
  defaultQuietHours: QuietHours;
  overdueDigestEnabled: boolean;
  nearExpiryDigestEnabled: boolean;
}

export interface LocalisationSettings {
  /** IANA zone used for notification quiet hours and digest day boundaries. */
  timezone: string;
  locale: string;
  dateFormat: string;
  currencyCode: string;
  currencySymbol: string;
}

export interface SecuritySettings {
  passwordMinLength: number;
  maxLoginAttempts: number;
  lockoutMinutes: number;
  forcePasswordChangeOnCreate: boolean;
}

export interface SystemSettings {
  business: BusinessSettings;
  finance: FinanceSettings;
  inventory: InventorySettings;
  delivery: DeliverySettings;
  notifications: NotificationSettings;
  localisation: LocalisationSettings;
  security: SecuritySettings;
}

/** Where an effective value came from, so administrators can see what is actually in force. */
export const SettingSource = {
  PERSISTED: 'PERSISTED',
  ENVIRONMENT: 'ENVIRONMENT',
  DEFAULT: 'DEFAULT',
} as const;
export type SettingSource = (typeof SettingSource)[keyof typeof SettingSource];

export interface SystemSettingsRecord {
  _id: string;
  settings: SystemSettings;
  /** Per-group provenance of the effective values. */
  sources: Record<SettingsGroup, SettingSource>;
  version: number;
  updatedBy?: string;
  updatedAt: string;
  createdAt: string;
}

/** Unauthenticated-safe subset used for branding and display formatting. */
export interface BrandingSettings {
  name: string;
  logoUrl?: string;
  locale: string;
  dateFormat: string;
  currencyCode: string;
  currencySymbol: string;
  timezone: string;
}

export const AdminUserAction = {
  CREATED: 'USER_CREATED',
  UPDATED: 'USER_UPDATED',
  ROLE_CHANGED: 'USER_ROLE_CHANGED',
  STATUS_CHANGED: 'USER_STATUS_CHANGED',
  PASSWORD_RESET: 'USER_PASSWORD_RESET',
  SESSIONS_REVOKED: 'USER_SESSIONS_REVOKED',
} as const;
export type AdminUserAction = (typeof AdminUserAction)[keyof typeof AdminUserAction];

export interface AuditLogRecord {
  _id: string;
  actorId: string | User;
  actorRole: UserRole;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
  createdAt: string;
}

/* Phase 11 — Returns, reporting and analytics */

export const ReturnStatus = {
  REQUESTED: 'REQUESTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  PARTIALLY_APPROVED: 'PARTIALLY_APPROVED',
  REJECTED: 'REJECTED',
  COLLECTED: 'COLLECTED',
  RECEIVED: 'RECEIVED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type ReturnStatus = (typeof ReturnStatus)[keyof typeof ReturnStatus];

/** Statuses after which the returned goods no longer count against the invoice. */
export const CLOSED_RETURN_STATUSES: ReturnStatus[] = [
  ReturnStatus.REJECTED,
  ReturnStatus.CANCELLED,
];

export const ReturnReason = {
  DAMAGED_IN_TRANSIT: 'DAMAGED_IN_TRANSIT',
  EXPIRED: 'EXPIRED',
  NEAR_EXPIRY: 'NEAR_EXPIRY',
  WRONG_ITEM: 'WRONG_ITEM',
  EXCESS_QUANTITY: 'EXCESS_QUANTITY',
  QUALITY_COMPLAINT: 'QUALITY_COMPLAINT',
  COLD_CHAIN_BREACH: 'COLD_CHAIN_BREACH',
  ORDER_ERROR: 'ORDER_ERROR',
  OTHER: 'OTHER',
} as const;
export type ReturnReason = (typeof ReturnReason)[keyof typeof ReturnReason];

/**
 * Where an inspected unit goes. Only `RESTOCK` returns a unit to saleable
 * stock; every other disposition keeps it out of allocation permanently.
 */
export const ReturnDisposition = {
  RESTOCK: 'RESTOCK',
  DAMAGED: 'DAMAGED',
  EXPIRED: 'EXPIRED',
  QUARANTINED: 'QUARANTINED',
} as const;
export type ReturnDisposition = (typeof ReturnDisposition)[keyof typeof ReturnDisposition];

export interface ReturnLine {
  medicineId: string;
  medicineSnapshot: {
    reference: string;
    sku: string;
    brandName: string;
    genericName: string;
    manufacturer: string;
    strength: string;
    dosageForm: string;
    packSize: string;
    unit: string;
  };
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  /** Quantity on the invoice line, the ceiling for every return against it. */
  invoicedQuantity: number;
  requestedQuantity: number;
  approvedQuantity: number;
  receivedQuantity: number;
  restockQuantity: number;
  damagedQuantity: number;
  expiredQuantity: number;
  quarantinedQuantity: number;
  unitPriceMinor: number;
  /** Share of the invoice line discount attributed to the approved quantity. */
  discountMinor: number;
  refundMinor: number;
  reason: ReturnReason;
  notes?: string;
}

export interface ReturnStatusHistoryEntry {
  from?: ReturnStatus;
  to: ReturnStatus;
  actorId: string;
  actorRole: UserRole;
  at: string;
  note?: string;
}

export interface ReturnRecord {
  _id: string;
  reference: string;
  orderId: string | Order;
  invoiceId: string | { _id: string; reference: string; grandTotalMinor: number };
  shopId: string | Shop;
  deliveryId?: string;
  status: ReturnStatus;
  primaryReason: ReturnReason;
  shopNotes?: string;
  internalNotes?: string;
  reviewNotes?: string;
  rejectionReason?: string;
  lines: ReturnLine[];
  requestedTotalMinor: number;
  approvedSubtotalMinor: number;
  approvedTaxMinor: number;
  approvedTotalMinor: number;
  creditNoteId?: string;
  creditNoteReference?: string;
  requestedBy: string | User;
  requestedAt: string;
  reviewedBy?: string | User;
  reviewedAt?: string;
  collectedBy?: string | User;
  collectedAt?: string;
  receivedBy?: string | User;
  receivedAt?: string;
  completedAt?: string;
  statusHistory: ReturnStatusHistoryEntry[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreditNoteLine {
  medicineSnapshot: ReturnLine['medicineSnapshot'];
  batchNumber: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  lineTotalMinor: number;
}

export interface CreditNoteRecord {
  _id: string;
  reference: string;
  returnId: string;
  returnReference: string;
  invoiceId: string;
  invoiceReference: string;
  orderId: string;
  shopId: string | Shop;
  supplierSnapshot: Record<string, string>;
  shopSnapshot: Record<string, string>;
  lines: CreditNoteLine[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  ledgerTransactionId?: string;
  issuedBy: string | User;
  issuedAt: string;
  createdAt: string;
}

/** Bucketing used by every time-series report so clients render one shape. */
export const ReportGranularity = { DAY: 'DAY', WEEK: 'WEEK', MONTH: 'MONTH' } as const;
export type ReportGranularity = (typeof ReportGranularity)[keyof typeof ReportGranularity];

export const SalesDimension = {
  MEDICINE: 'MEDICINE',
  CATEGORY: 'CATEGORY',
  MANUFACTURER: 'MANUFACTURER',
  SHOP: 'SHOP',
  TERRITORY: 'TERRITORY',
} as const;
export type SalesDimension = (typeof SalesDimension)[keyof typeof SalesDimension];

export interface ReportPeriod {
  from: string;
  to: string;
  granularity: ReportGranularity;
}

export interface SalesSeriesPoint {
  bucket: string;
  invoiceCount: number;
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  netMinor: number;
  returnedMinor: number;
  netAfterReturnsMinor: number;
}

export interface SalesSummaryReport {
  period: ReportPeriod;
  totals: {
    invoiceCount: number;
    shopCount: number;
    unitsSold: number;
    grossMinor: number;
    discountMinor: number;
    taxMinor: number;
    deliveryChargeMinor: number;
    netMinor: number;
    returnedMinor: number;
    netAfterReturnsMinor: number;
    averageInvoiceMinor: number;
  };
  series: SalesSeriesPoint[];
}

export interface DimensionRow {
  key: string;
  label: string;
  secondaryLabel?: string;
  invoiceCount: number;
  quantity: number;
  netMinor: number;
  returnedMinor: number;
  sharePercentBasisPoints: number;
}

export interface OrderFunnelReport {
  period: ReportPeriod;
  statusCounts: Array<{ status: OrderStatus; count: number }>;
  funnel: {
    submitted: number;
    reviewed: number;
    approved: number;
    rejected: number;
    invoiced: number;
    delivered: number;
    cancelled: number;
  };
  conversionBasisPoints: { approval: number; fulfilment: number; delivery: number };
  cycleTimeHours: {
    submitToReview: number | null;
    reviewToInvoice: number | null;
    invoiceToDelivery: number | null;
    submitToDelivery: number | null;
  };
  series: Array<{ bucket: string; submitted: number; approved: number; delivered: number }>;
}

export interface InventoryValuationRow {
  key: string;
  label: string;
  batchCount: number;
  onHand: number;
  available: number;
  costValueMinor: number;
  retailValueMinor: number;
}

export interface ExpiryBucketRow {
  bucket: 'EXPIRED' | 'WITHIN_30_DAYS' | 'WITHIN_90_DAYS' | 'BEYOND_90_DAYS';
  batchCount: number;
  quantity: number;
  costValueMinor: number;
}

export interface InventoryAnalyticsReport {
  asOf: string;
  totals: {
    batchCount: number;
    onHand: number;
    available: number;
    costValueMinor: number;
    retailValueMinor: number;
    blockedBatchCount: number;
  };
  byCategory: InventoryValuationRow[];
  expiryBuckets: ExpiryBucketRow[];
  lowStock: Array<{
    medicineId: string;
    reference: string;
    brandName: string;
    genericName: string;
    available: number;
    threshold: number;
  }>;
  deadStock: Array<{
    batchId: string;
    medicineId: string;
    brandName: string;
    batchNumber: string;
    expiryDate: string;
    available: number;
    costValueMinor: number;
    lastMovementAt?: string;
  }>;
}

export interface DeliveryPerformanceReport {
  period: ReportPeriod;
  totals: {
    total: number;
    delivered: number;
    partiallyDelivered: number;
    failed: number;
    returnedToStore: number;
    onTime: number;
    late: number;
    successBasisPoints: number;
    onTimeBasisPoints: number;
    averageCycleHours: number | null;
  };
  failureReasons: Array<{ reason: DeliveryFailureReason; count: number }>;
  byPerson: Array<{
    userId: string;
    name: string;
    assigned: number;
    delivered: number;
    failed: number;
    onTime: number;
    successBasisPoints: number;
    collectedMinor: number;
  }>;
  series: Array<{ bucket: string; delivered: number; failed: number }>;
}

export interface ReturnsAnalyticsReport {
  period: ReportPeriod;
  totals: {
    returnCount: number;
    completedCount: number;
    pendingCount: number;
    unitsReturned: number;
    unitsRestocked: number;
    unitsWrittenOff: number;
    requestedMinor: number;
    creditedMinor: number;
    pendingCreditMinor: number;
    salesNetMinor: number;
    returnRateBasisPoints: number;
  };
  byReason: Array<{
    reason: ReturnReason;
    returnCount: number;
    quantity: number;
    creditedMinor: number;
  }>;
  byMedicine: Array<{
    medicineId: string;
    brandName: string;
    genericName: string;
    quantity: number;
    creditedMinor: number;
  }>;
  byStatus: Array<{ status: ReturnStatus; count: number }>;
  series: Array<{ bucket: string; returnCount: number; creditedMinor: number }>;
}

export interface ReceivablesAgeingReport {
  asOf: string;
  buckets: Array<{
    bucket: 'CURRENT' | 'DAYS_1_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'DAYS_90_PLUS';
    invoiceCount: number;
    amountMinor: number;
  }>;
  rows: Array<{
    shopId: string;
    shopReference: string;
    shopName: string;
    currentMinor: number;
    days1to30Minor: number;
    days31to60Minor: number;
    days61to90Minor: number;
    days90PlusMinor: number;
    totalMinor: number;
  }>;
  totalMinor: number;
}

export interface AnalyticsOverview {
  period: ReportPeriod;
  sales: SalesSummaryReport['totals'];
  salesSeries: SalesSeriesPoint[];
  orders: OrderFunnelReport['funnel'];
  orderCycleHours: OrderFunnelReport['cycleTimeHours'];
  delivery: DeliveryPerformanceReport['totals'];
  returns: ReturnsAnalyticsReport['totals'];
  receivables: {
    outstandingMinor: number;
    overdueMinor: number;
    ageing: ReceivablesAgeingReport['buckets'];
  };
  inventory: {
    costValueMinor: number;
    available: number;
    expiringSoonBatches: number;
    lowStockCount: number;
  };
  topMedicines: DimensionRow[];
  topShops: DimensionRow[];
}

/*
 * ── Purchasing, goods receipt and the recall trace ───────────────────────────
 *
 * The models and the endpoints have existed since phase 6 and appeared in none
 * of the 51 navigation items, so nothing outside the API ever needed a type for
 * them. Phase 10 gives them screens, and a screen needs to know what it is
 * looking at.
 */

export interface Supplier {
  _id: string;
  reference: string;
  name: string;
  /** The supplier's own licence, which an inspection checks. */
  drugLicenceNumber?: string;
  drugLicenceExpiryDate?: string;
  contactName?: string;
  primaryPhone: string;
  email?: string;
  address?: string;
  /** Days from invoice to payment, as agreed. Money is settled outside this system. */
  paymentTermsDays: number;
  isActive: boolean;
  notes?: string;
  version: number;
  createdAt: string;
}

export const PurchaseOrderStatus = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;
export type PurchaseOrderStatus = (typeof PurchaseOrderStatus)[keyof typeof PurchaseOrderStatus];

export interface PurchaseOrderLine {
  _id: string;
  medicineId: string;
  medicineSnapshot: {
    reference?: string;
    sku?: string;
    brandName?: string;
    genericName?: string;
    strength?: string;
  };
  orderedQuantity: number;
  /** Running total of what has actually arrived, advanced by each receipt. */
  receivedQuantity: number;
  unitCostMinor: number;
}

export interface PurchaseOrder {
  _id: string;
  reference: string;
  supplierId: string | Pick<Supplier, '_id' | 'reference' | 'name'>;
  status: PurchaseOrderStatus;
  lines: PurchaseOrderLine[];
  expectedDate?: string;
  /** The supplier's own reference, so a paper invoice can be matched to this. */
  supplierReference?: string;
  notes?: string;
  issuedAt?: string;
  version: number;
  createdAt: string;
}

export interface GoodsReceiptLine {
  purchaseOrderLineId: string;
  medicineId: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  orderedQuantity: number;
  receivedQuantity: number;
  /**
   * Ordered minus received at the moment of this receipt. Recorded rather than
   * silently accepted: a short delivery is a conversation with the supplier and,
   * on a controlled line, a question an inspector may ask.
   */
  varianceQuantity: number;
  varianceReason?: string;
  unitCostMinor: number;
}

export interface GoodsReceipt {
  _id: string;
  reference: string;
  purchaseOrderId: string;
  supplierId: string;
  supplierInvoiceReference?: string;
  receivedAt: string;
  lines: GoodsReceiptLine[];
  notes?: string;
}

/** One shop that received part of a batch. */
export interface RecallRecipient {
  shopId: string;
  shopReference: string;
  shopName: string;
  /** The number somebody rings when the recall is real. */
  primaryPhone: string;
  invoiceId: string;
  invoiceReference: string;
  invoiceDate: string;
  quantity: number;
  deliveredAt?: string;
  deliveryReference?: string;
  receiverName?: string;
}

/** Where a batch came from. */
export interface RecallOrigin {
  supplierId?: string;
  supplierName?: string;
  supplierReference?: string;
  supplierPhone?: string;
  drugLicenceNumber?: string;
  purchaseOrderReference?: string;
  goodsReceiptReference?: string;
  supplierInvoiceReference?: string;
  supplierBatchReference?: string;
  receivedAt?: string;
  /**
   * True when the batch predates purchasing. Said plainly rather than left as
   * an absent supplier: "we do not know" and "this arrived before we recorded
   * suppliers" are different answers to an inspector, and only one is
   * defensible.
   */
  predatesPurchasing: boolean;
}

export interface RecallTrace {
  batch: {
    id: string;
    batchNumber: string;
    expiryDate: string;
    manufacturingDate: string;
    receivedQuantity: number;
    remainingOnHand: number;
    isBlocked: boolean;
    isQuarantined: boolean;
  };
  medicine: {
    id: string;
    reference: string;
    brandName: string;
    genericName: string;
    strength: string;
    manufacturer: string;
  };
  recipients: RecallRecipient[];
  origin: RecallOrigin;
  totals: {
    shopsAffected: number;
    quantityDespatched: number;
    quantityStillHeld: number;
    /** Received, minus despatched, minus what is still on the shelf. */
    quantityUnaccounted: number;
  };
}

/** A candidate batch found by the number printed on the carton. */
export interface RecallBatchCandidate {
  _id: string;
  batchNumber: string;
  expiryDate: string;
  medicineId: Pick<Medicine, '_id' | 'reference' | 'brandName' | 'genericName' | 'strength'> & {
    manufacturer?: string;
  };
  quantities: { onHand: number; available: number };
}

/** One prescription medicine's movements over a period. */
export interface ControlledRegisterRow {
  medicineId: string;
  reference: string;
  brandName: string;
  genericName: string;
  strength: string;
  openingQuantity: number;
  receivedQuantity: number;
  despatchedQuantity: number;
  returnedQuantity: number;
  writtenOffQuantity: number;
  closingQuantity: number;
  /**
   * Opening + in − out, compared with what the shelf says.
   *
   * A register that only adds up its own movements can never disagree with
   * itself, which makes it useless as a control. Anything other than zero is a
   * question somebody has to answer.
   */
  varianceQuantity: number;
}

/** Which shop bought how much of a prescription medicine. */
export interface ControlledByShopRow {
  _id: { shopId: string; medicineId: string };
  shopSnapshot?: { reference?: string; name?: string };
  medicine?: { reference: string; brandName: string; genericName: string; strength: string };
  quantity: number;
  invoices: string[];
}

export interface ControlledRegister {
  period: { from: string; to: string };
  rows: ControlledRegisterRow[];
  byShop: ControlledByShopRow[];
}

/*
 * ── Stocktake ───────────────────────────────────────────────────────────────
 *
 * `POST /batches/:id/adjust` corrects one batch with one reason. A physical
 * count is one event over many batches, approved once and posted once, and for
 * an inspected operation it is a document rather than a series of edits.
 */

export const StocktakeStatus = {
  COUNTING: 'COUNTING',
  REVIEW: 'REVIEW',
  POSTED: 'POSTED',
  ABANDONED: 'ABANDONED',
} as const;
export type StocktakeStatus = (typeof StocktakeStatus)[keyof typeof StocktakeStatus];

export interface StocktakeLine {
  _id: string;
  batchId: string;
  medicineId: string;
  snapshot: {
    brandName?: string;
    genericName?: string;
    strength?: string;
    batchNumber?: string;
    warehouseLocation?: string;
    expiryDate?: string;
  };
  /**
   * **Absent while the count is open.** The server strips it, because a blind
   * count that ships the answer in the response is not blind whatever the
   * screen shows.
   */
  systemQuantity?: number;
  /** `null` until somebody counts it, which is not the same as zero. */
  countedQuantity: number | null;
  countedAt?: string;
  varianceReason?: string;
}

export interface StocktakeSummary {
  linesTotal: number;
  linesCounted: number;
  linesUncounted: number;
  linesDiffering: number;
  unitsOver: number;
  unitsShort: number;
}

export interface Stocktake {
  _id: string;
  reference: string;
  status: StocktakeStatus;
  scope: { warehouseLocation?: string; medicineIds?: string[] };
  lines: StocktakeLine[];
  notes?: string;
  openedAt: string;
  postedAt?: string;
  abandonedAt?: string;
  abandonedReason?: string;
  version: number;
  /** Withheld with the expected quantities while the count is open. */
  summary?: StocktakeSummary;
}

/** A row in the index: progress, never the sheet. */
export interface StocktakeListRow {
  _id: string;
  reference: string;
  status: StocktakeStatus;
  scope: { warehouseLocation?: string };
  openedAt: string;
  postedAt?: string;
  summary: StocktakeSummary;
}
