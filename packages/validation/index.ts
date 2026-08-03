import { z } from 'zod';
import {
  ActivityEntityType,
  DeliveryFailureReason,
  DeliveryPriority,
  DeliveryProofType,
  LedgerTransactionType,
  MedicineClassification,
  NotificationCategory,
  NotificationChannel,
  NotificationEvent,
  PaymentMethod,
  PushPlatform,
  ReportGranularity,
  ReturnReason,
  ReturnStatus,
  SalesDimension,
  StockMovementType,
  UserRole,
} from '@medsupply/shared-types';

// Bangladesh phone: starts with +880 or 01, then 9 more digits
const bdPhone = z
  .string()
  .regex(
    /^(\+8801|01)[3-9]\d{8}$/,
    'Invalid Bangladesh phone number (e.g. +8801712345678 or 01712345678)',
  );

export const AddressSchema = z.object({
  label: z.string().min(1),
  line1: z.string().min(5),
  line2: z.string().optional(),
  city: z.string().min(2),
  district: z.string().min(2),
  postalCode: z.string().optional(),
  isDefault: z.boolean().default(false),
});

export const CreateShopSchema = z.object({
  name: z.string().min(3),
  primaryPhone: bdPhone,
  alternativePhone: bdPhone.optional(),
  email: z.string().email().optional(),
  territory: z.string().optional(),
  drugLicenceNumber: z.string().optional(),
  drugLicenceIssueDate: z.coerce.date().optional(),
  drugLicenceExpiryDate: z.coerce.date().optional(),
  tradeLicenceNumber: z.string().optional(),
  creditLimit: z.number().int().min(0).default(0),
  paymentTermsDays: z.number().int().min(0).default(30),
  defaultDiscount: z.number().min(0).max(100).default(0),
  billingAddress: AddressSchema.optional(),
  deliveryAddresses: z.array(AddressSchema).default([]),
  notes: z.string().optional(),
});

export const UpdateShopSchema = CreateShopSchema.partial();

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  role: z.nativeEnum(UserRole),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

const moneyMinor = z.number().int().min(0);
const positiveQuantity = z.number().int().positive();

const MedicineFieldsSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .transform((value) => value.toUpperCase()),
  barcode: z.string().trim().min(6).max(32).optional(),
  brandName: z.string().trim().min(2).max(120),
  genericName: z.string().trim().min(2).max(160),
  manufacturer: z.string().trim().min(2).max(120),
  strength: z.string().trim().min(1).max(60),
  dosageForm: z.string().trim().min(2).max(60),
  packSize: z.string().trim().min(1).max(60),
  unit: z.string().trim().min(1).max(30),
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().max(2000).optional(),
  productImageUrl: z.string().url().optional(),
  costPriceMinor: moneyMinor,
  defaultSellingPriceMinor: moneyMinor,
  minimumOrderQuantity: positiveQuantity.default(1),
  maximumOrderQuantity: positiveQuantity.optional(),
  classification: z.nativeEnum(MedicineClassification),
  coldChain: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

const validateMedicineLimits = (
  value: { minimumOrderQuantity?: number; maximumOrderQuantity?: number },
  context: z.RefinementCtx,
) => {
  if (
    value.maximumOrderQuantity !== undefined &&
    value.minimumOrderQuantity !== undefined &&
    value.maximumOrderQuantity < value.minimumOrderQuantity
  ) {
    context.addIssue({
      code: 'custom',
      path: ['maximumOrderQuantity'],
      message: 'Maximum order quantity must be at least the minimum',
    });
  }
};

export const CreateMedicineSchema = MedicineFieldsSchema.superRefine(validateMedicineLimits);
export const UpdateMedicineSchema =
  MedicineFieldsSchema.partial().superRefine(validateMedicineLimits);

export const ReceiveStockSchema = z
  .object({
    medicineId: z.string().min(1),
    batchNumber: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .transform((value) => value.toUpperCase()),
    manufacturingDate: z.coerce.date(),
    expiryDate: z.coerce.date(),
    costPriceMinor: moneyMinor,
    sellingPriceOverrideMinor: moneyMinor.optional(),
    quantity: positiveQuantity,
    warehouseLocation: z.string().trim().min(1).max(100),
    notes: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, context) => {
    if (value.expiryDate <= value.manufacturingDate) {
      context.addIssue({
        code: 'custom',
        path: ['expiryDate'],
        message: 'Expiry date must be after manufacturing date',
      });
    }
    if (value.expiryDate <= new Date()) {
      context.addIssue({
        code: 'custom',
        path: ['expiryDate'],
        message: 'Cannot receive expired stock',
      });
    }
  });

export const StockOperationSchema = z.object({
  type: z.nativeEnum(StockMovementType),
  quantity: positiveQuantity,
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
  referenceType: z.string().trim().max(50).optional(),
  referenceId: z.string().trim().max(100).optional(),
});

export const AdjustmentSchema = z.object({
  newOnHand: z.number().int().min(0),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const AllocationSchema = z.object({
  medicineId: z.string().min(1),
  quantity: positiveQuantity,
  idempotencyKey: z.string().trim().min(8).max(120),
  referenceType: z.string().trim().min(1).max(50),
  referenceId: z.string().trim().min(1).max(100),
});

export const OrderItemInputSchema = z.object({
  medicineId: z.string().min(1),
  requestedQuantity: positiveQuantity,
  shopNotes: z.string().trim().max(500).optional(),
});

export const SaveOrderDraftSchema = z.object({
  items: z.array(OrderItemInputSchema).min(1).max(100),
  deliveryAddressId: z.string().optional(),
  requestedPaymentMethod: z.nativeEnum(PaymentMethod).optional(),
  purchaseOrderReference: z.string().trim().max(100).optional(),
  shopNotes: z.string().trim().max(1000).optional(),
});

export const SubmitOrderSchema = SaveOrderDraftSchema.extend({
  deliveryAddressId: z.string().min(1),
  requestedPaymentMethod: z.nativeEnum(PaymentMethod),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const CancellationRequestSchema = z.object({ reason: z.string().trim().min(5).max(500) });
export const ReviewVersionSchema = z.object({ version: z.number().int().min(0) });
export const HoldOrderSchema = ReviewVersionSchema.extend({
  reason: z.string().trim().min(5).max(500),
  internalNotes: z.string().trim().max(1000).optional(),
  shopOwnerNotes: z.string().trim().max(1000).optional(),
});
export const RejectOrderSchema = HoldOrderSchema;
export const ApprovalSchema = ReviewVersionSchema.extend({
  lines: z
    .array(
      z.object({
        orderItemId: z.string(),
        approvedQuantity: z.number().int().min(0),
        unitPriceMinor: z.number().int().min(0),
        lineDiscountMinor: z.number().int().min(0).default(0),
      }),
    )
    .min(1),
  orderDiscountMinor: z.number().int().min(0).default(0),
  deliveryChargeMinor: z.number().int().min(0).default(0),
  internalNotes: z.string().trim().max(1000).optional(),
  shopOwnerNotes: z.string().trim().max(1000).optional(),
  creditOverride: z.boolean().default(false),
});
export const DiscrepancyTypeSchema = z.enum([
  'MISSING_QUANTITY',
  'DAMAGED_ITEM',
  'WRONG_BATCH',
  'EXPIRED_BATCH',
  'STOCK_MISMATCH',
  'PRODUCT_UNAVAILABLE',
  'OTHER',
]);
export const PickingActionSchema = z.object({ version: z.number().int().min(0) });
export const DiscrepancySchema = z.object({
  version: z.number().int().min(0),
  type: DiscrepancyTypeSchema,
  medicineId: z.string(),
  batchId: z.string().optional(),
  quantity: z.number().int().min(0),
  notes: z.string().trim().min(3).max(1000),
});
export const PickingProgressSchema = z.object({
  version: z.number().int().min(0),
  action: z.enum(['SAVE', 'PAUSE', 'COMPLETE']),
  items: z
    .array(
      z.object({
        medicineId: z.string(),
        batchId: z.string(),
        pickedQuantity: z.number().int().min(0),
      }),
    )
    .min(1),
});
export const DiscrepancyResolutionSchema = z.object({
  version: z.number().int().min(0),
  resolutionNotes: z.string().trim().min(3).max(1000),
});
export const PackingSchema = z.object({
  version: z.number().int().min(0),
  items: z
    .array(
      z.object({
        medicineId: z.string(),
        batchId: z.string(),
        packedQuantity: z.number().int().min(0),
        shortfallReason: z.string().trim().min(3).max(500).optional(),
      }),
    )
    .min(1),
  packageCount: z.number().int().positive(),
  weightGrams: z.number().int().min(0).optional(),
  notes: z.string().trim().max(1000).optional(),
});

const deliveryActionBase = z.object({
  version: z.number().int().min(0),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const DeliveryAssignmentSchema = deliveryActionBase.extend({
  deliveryPersonId: z.string().min(1),
  expectedDeliveryDate: z.coerce.date(),
  priority: z.nativeEnum(DeliveryPriority).default(DeliveryPriority.NORMAL),
  instructions: z.string().trim().max(1000).optional(),
});

export const DeliveryHandoverSchema = deliveryActionBase.extend({
  packageReference: z.string().trim().min(1).max(80),
  invoiceReference: z.string().trim().min(1).max(80),
  packageCount: z.number().int().positive(),
});

export const DeliverySimpleActionSchema = deliveryActionBase;

export const DeliveryFailureSchema = deliveryActionBase.extend({
  reason: z.nativeEnum(DeliveryFailureReason),
  notes: z.string().trim().min(3).max(1000),
});

const proofFileSchema = z.object({
  fileName: z.string().trim().min(1).max(120),
  mimeType: z.enum(['image/jpeg', 'image/png']),
  base64Data: z.string().min(8).max(2_800_000),
});

const paymentAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(120),
  mimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  base64Data: z.string().min(8).max(2_800_000),
});

export const DeliveryCompletionSchema = deliveryActionBase
  .extend({
    receiverName: z.string().trim().min(2).max(120),
    receiverPhone: bdPhone,
    otp: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    signature: proofFileSchema.optional(),
    photograph: proofFileSchema.optional(),
    gps: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracyMetres: z.number().min(0).max(10000).optional(),
        capturedAt: z.coerce.date(),
      })
      .optional(),
    notes: z.string().trim().max(1000).optional(),
    deliveredPackageCount: z.number().int().positive(),
    noPaymentCollected: z.boolean().default(false),
    collectedAmountMinor: z.number().int().min(0).default(0),
    collectionMethod: z
      .enum([
        PaymentMethod.CASH,
        PaymentMethod.BANK_TRANSFER,
        PaymentMethod.MOBILE_FINANCIAL_SERVICE,
        PaymentMethod.CHEQUE,
        PaymentMethod.OTHER,
      ])
      .optional(),
    transactionReference: z.string().trim().max(120).optional(),
    paymentProof: paymentAttachmentSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.noPaymentCollected && value.collectedAmountMinor !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['collectedAmountMinor'],
        message: 'Collected amount must be zero when no payment was collected',
      });
    }
    if (!value.noPaymentCollected && value.collectedAmountMinor > 0 && !value.collectionMethod) {
      context.addIssue({
        code: 'custom',
        path: ['collectionMethod'],
        message: 'Collection method is required',
      });
    }
    if (
      value.collectedAmountMinor > 0 &&
      value.collectionMethod !== PaymentMethod.CASH &&
      !value.transactionReference
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transactionReference'],
        message: 'Transaction reference is required for non-cash collections',
      });
    }
  });

export const CreatePaymentSchema = z
  .object({
    shopId: z.string().min(1),
    invoiceId: z.string().min(1).optional(),
    deliveryId: z.string().min(1).optional(),
    amountMinor: z.number().int().positive(),
    method: z.nativeEnum(PaymentMethod),
    transactionReference: z.string().trim().min(2).max(120).optional(),
    collectedAt: z.coerce.date().default(() => new Date()),
    notes: z.string().trim().max(1000).optional(),
    attachment: paymentAttachmentSchema.optional(),
    allowAdvance: z.boolean().default(false),
    postNow: z.boolean().default(false),
    idempotencyKey: z.string().trim().min(8).max(120),
  })
  .superRefine((value, context) => {
    if (value.method === PaymentMethod.CREDIT) {
      context.addIssue({
        code: 'custom',
        path: ['method'],
        message: 'CREDIT is an order term, not a received-payment method',
      });
    }
    if (
      value.method !== PaymentMethod.CASH &&
      value.method !== PaymentMethod.ADVANCE_BALANCE &&
      !value.transactionReference
    ) {
      context.addIssue({
        code: 'custom',
        path: ['transactionReference'],
        message: 'Transaction reference is required for this payment method',
      });
    }
  });

export const PaymentPostSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  allowAdvance: z.boolean().default(false),
});

export const PaymentFailSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  reason: z.string().trim().min(3).max(500),
});

export const PaymentReverseSchema = PaymentFailSchema;

export const PaymentHandoverSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const LedgerAdjustmentSchema = z.object({
  shopId: z.string().min(1),
  type: z.enum([
    LedgerTransactionType.OPENING_BALANCE,
    LedgerTransactionType.CREDIT_ADJUSTMENT,
    LedgerTransactionType.DEBIT_ADJUSTMENT,
    LedgerTransactionType.RETURN_CREDIT,
  ]),
  amountMinor: z.number().int().positive(),
  occurredAt: z.coerce.date().default(() => new Date()),
  description: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const CreditReservationBackfillSchema = z.object({
  orderId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'A valid Order ID is required'),
  reason: z.string().trim().min(5).max(500),
  idempotencyKey: z.string().trim().min(8).max(120),
});

/* Phase 9 — Notifications, real-time updates and activity timeline */

const notificationChannelSchema = z.enum([
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
  NotificationChannel.SMS,
  NotificationChannel.PUSH,
  NotificationChannel.WHATSAPP,
]);

const optionalChannelSchema = z.enum([
  NotificationChannel.EMAIL,
  NotificationChannel.SMS,
  NotificationChannel.PUSH,
  NotificationChannel.WHATSAPP,
]);

const notificationEventSchema = z.enum(
  Object.values(NotificationEvent) as [NotificationEvent, ...NotificationEvent[]],
);

const notificationCategorySchema = z.enum(
  Object.values(NotificationCategory) as [NotificationCategory, ...NotificationCategory[]],
);

const activityEntityTypeSchema = z.enum(
  Object.values(ActivityEntityType) as [ActivityEntityType, ...ActivityEntityType[]],
);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'A valid ID is required');

const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must use 24-hour HH:mm format');

export const NotificationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: notificationCategorySchema.optional(),
  event: notificationEventSchema.optional(),
  unreadOnly: z.coerce.boolean().default(false),
  includeArchived: z.coerce.boolean().default(false),
});

export const NotificationIdsSchema = z.object({
  notificationIds: z.array(objectId).min(1).max(200),
});

export const NotificationMarkAllReadSchema = z.object({
  category: notificationCategorySchema.optional(),
  /** Guards against marking notifications that arrived after the client rendered. */
  before: z.coerce.date().optional(),
});

export const NotificationPreferenceUpdateSchema = z
  .object({
    defaultChannels: z.array(optionalChannelSchema).max(4).optional(),
    overrides: z
      .array(
        z.object({
          event: notificationEventSchema,
          channels: z.array(optionalChannelSchema).max(4),
        }),
      )
      .max(Object.keys(NotificationEvent).length)
      .optional(),
    quietHours: z
      .object({
        enabled: z.boolean(),
        start: localTime,
        end: localTime,
      })
      .refine((value) => !value.enabled || value.start !== value.end, {
        message: 'Quiet hours must not start and end at the same time',
      })
      .optional(),
    mutedEvents: z.array(notificationEventSchema).optional(),
  })
  .refine(
    (value) =>
      !value.overrides ||
      new Set(value.overrides.map((entry) => entry.event)).size === value.overrides.length,
    { message: 'Each event may appear at most once in overrides' },
  );

export const PushDeviceRegisterSchema = z.object({
  /** Expo push tokens; a raw device token is rejected so the adapter never guesses. */
  token: z
    .string()
    .trim()
    .min(10)
    .max(255)
    .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, 'A valid Expo push token is required'),
  platform: z.enum([PushPlatform.ANDROID, PushPlatform.IOS, PushPlatform.WEB]),
  deviceName: z.string().trim().max(120).optional(),
});

export const PushDeviceUnregisterSchema = z.object({
  token: z.string().trim().min(10).max(255),
});

export const ActivityTimelineQuerySchema = z.object({
  entityType: activityEntityTypeSchema,
  entityId: objectId,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const ActivityFeedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  category: notificationCategorySchema.optional(),
  shopId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const NotificationTestSendSchema = z.object({
  recipientId: objectId,
  event: notificationEventSchema,
  channels: z.array(notificationChannelSchema).min(1).max(5),
  note: z.string().trim().min(3).max(300),
});

/* Phase 10 — System settings, configuration and administration */

const settingsObjectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'A valid ID is required');

const quietHoursSchema = z
  .object({
    enabled: z.boolean(),
    start: localTime,
    end: localTime,
  })
  .refine((value) => !value.enabled || value.start !== value.end, {
    message: 'Quiet hours must not start and end at the same time',
  });

export const BusinessSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).optional(),
  logoUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  address: z.string().trim().max(400),
  phone: z.string().trim().max(40),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  website: z.string().trim().url().max(200).optional().or(z.literal('')),
  tradeLicenceNumber: z.string().trim().max(80).optional(),
  drugLicenceNumber: z.string().trim().max(80).optional(),
  invoiceFooter: z.string().trim().max(600),
});

export const FinanceSettingsSchema = z.object({
  // Basis points keep tax exact in integer arithmetic; 10000 would be 100%.
  taxBasisPoints: z.number().int().min(0).max(10_000),
  defaultPaymentTermsDays: z.number().int().min(0).max(365),
  creditBlockOnLimitExceeded: z.boolean(),
  creditBlockOverdueThresholdMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  creditOverdueGraceDays: z.number().int().min(0).max(365),
  customerAdvanceEnabled: z.boolean(),
  deliveryCollectionRequiresVerification: z.boolean(),
});

export const InventorySettingsSchema = z.object({
  nearExpiryDays: z.number().int().min(1).max(365),
  lowStockThreshold: z.number().int().min(0).max(1_000_000),
});

export const DeliverySettingsSchema = z.object({
  requiredProofs: z
    .array(
      z.enum([
        DeliveryProofType.OTP,
        DeliveryProofType.SIGNATURE,
        DeliveryProofType.PHOTOGRAPH,
        DeliveryProofType.GPS,
      ]),
    )
    .max(4),
  otpExpiryMinutes: z.number().int().min(1).max(60),
});

export const NotificationSettingsSchema = z.object({
  defaultQuietHours: quietHoursSchema,
  overdueDigestEnabled: z.boolean(),
  nearExpiryDigestEnabled: z.boolean(),
});

export const LocalisationSettingsSchema = z.object({
  timezone: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .refine((value) => {
      // Rejecting an unknown zone here prevents every later date format throwing.
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown IANA time zone'),
  locale: z.enum(['en', 'bn']),
  dateFormat: z.enum(['DD MMM YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']),
  currencyCode: z.string().trim().length(3).toUpperCase(),
  currencySymbol: z.string().trim().min(1).max(4),
});

export const SecuritySettingsSchema = z.object({
  passwordMinLength: z.number().int().min(8).max(128),
  maxLoginAttempts: z.number().int().min(3).max(20),
  lockoutMinutes: z.number().int().min(1).max(1440),
  forcePasswordChangeOnCreate: z.boolean(),
});

/** Full replacement of one group; partial writes would hide removed fields. */
export const SettingsUpdateSchema = z.object({
  group: z.enum([
    'business',
    'finance',
    'inventory',
    'delivery',
    'notifications',
    'localisation',
    'security',
  ]),
  values: z.record(z.string(), z.unknown()),
  /** Optimistic concurrency: rejects a save based on a stale settings read. */
  version: z.number().int().min(0),
});

export const SettingsResetSchema = z.object({
  group: SettingsUpdateSchema.shape.group,
  version: z.number().int().min(0),
  reason: z.string().trim().min(3).max(300),
});

export const AdminUserListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: z
    .enum([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.STOREKEEPER,
      UserRole.DELIVERY_PERSON,
      UserRole.SHOP_OWNER,
    ])
    .optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  q: z.string().trim().max(120).optional(),
});

export const AdminUserUpdateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    phone: z
      .string()
      .regex(/^(\+8801|01)[3-9]\d{8}$/, 'Invalid Bangladesh phone number')
      .optional()
      .or(z.literal('')),
    role: AdminUserListQuerySchema.shape.role,
    status: AdminUserListQuerySchema.shape.status,
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'At least one field must be provided',
  });

export const AdminPasswordResetSchema = z.object({
  temporaryPassword: z.string().min(8).max(128),
  reason: z.string().trim().min(3).max(300),
});

export const AdminSessionRevokeSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

export const AuditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: settingsObjectId.optional(),
  actorId: settingsObjectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/* Phase 11 — Returns, reporting and analytics */

const returnReasonSchema = z.enum(Object.values(ReturnReason) as [ReturnReason, ...ReturnReason[]]);

export const CreateReturnSchema = z.object({
  invoiceId: objectId,
  primaryReason: returnReasonSchema,
  shopNotes: z.string().trim().max(1000).optional(),
  lines: z
    .array(
      z.object({
        medicineId: objectId,
        batchId: objectId,
        quantity: positiveQuantity,
        reason: returnReasonSchema,
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(100)
    .superRefine((lines, context) => {
      // The invoice can carry the same medicine on two batches, but never the
      // same batch twice, so a duplicate here would double-count the ceiling.
      const seen = new Set(lines.map((line) => `${line.medicineId}:${line.batchId}`));
      if (seen.size !== lines.length) {
        context.addIssue({
          code: 'custom',
          message: 'Each invoice batch line may appear only once in a return request',
        });
      }
    }),
  idempotencyKey: z.string().trim().min(8).max(120),
});

const returnActionBase = z.object({
  version: z.number().int().min(0),
  idempotencyKey: z.string().trim().min(8).max(120),
});

export const ReturnReviewStartSchema = returnActionBase;

export const ReturnDecisionSchema = returnActionBase.extend({
  lines: z
    .array(
      z.object({
        medicineId: objectId,
        batchId: objectId,
        approvedQuantity: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(100),
  reviewNotes: z.string().trim().max(1000).optional(),
  internalNotes: z.string().trim().max(1000).optional(),
});

export const ReturnRejectionSchema = returnActionBase.extend({
  rejectionReason: z.string().trim().min(5).max(500),
  internalNotes: z.string().trim().max(1000).optional(),
});

export const ReturnCancelSchema = returnActionBase.extend({
  reason: z.string().trim().min(5).max(500),
});

export const ReturnCollectionSchema = returnActionBase.extend({
  notes: z.string().trim().max(1000).optional(),
});

export const ReturnReceiptSchema = returnActionBase.extend({
  lines: z
    .array(
      z
        .object({
          medicineId: objectId,
          batchId: objectId,
          restockQuantity: z.number().int().min(0),
          damagedQuantity: z.number().int().min(0),
          expiredQuantity: z.number().int().min(0),
          quarantinedQuantity: z.number().int().min(0),
          notes: z.string().trim().max(500).optional(),
        })
        .refine(
          (line) =>
            line.restockQuantity +
              line.damagedQuantity +
              line.expiredQuantity +
              line.quarantinedQuantity >
            0,
          { message: 'Record at least one inspected unit for each received line' },
        ),
    )
    .min(1)
    .max(100),
  notes: z.string().trim().max(1000).optional(),
});

export const CreditNoteIssueSchema = returnActionBase.extend({
  notes: z.string().trim().max(1000).optional(),
});

export const ReturnListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(Object.values(ReturnStatus) as [ReturnStatus, ...ReturnStatus[]]).optional(),
  shopId: objectId.optional(),
  reason: returnReasonSchema.optional(),
  q: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** `YYYY-MM-DD` only; a full timestamp would make a day boundary ambiguous. */
const reportDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must use YYYY-MM-DD');

const reportRangeFields = z.object({
  from: reportDate,
  to: reportDate,
  granularity: z
    .enum([ReportGranularity.DAY, ReportGranularity.WEEK, ReportGranularity.MONTH])
    .default(ReportGranularity.DAY),
  shopId: objectId.optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

// Compared as ISO strings, which sort chronologically for a fixed-width date.
const orderedRange = {
  check: (value: { from: string; to: string }) => value.from <= value.to,
  options: { path: ['from'], message: 'The start date must not be after the end date' },
};

export const ReportRangeSchema = reportRangeFields.refine(orderedRange.check, orderedRange.options);

export const SalesDimensionQuerySchema = reportRangeFields
  .extend({
    dimension: z
      .enum(Object.values(SalesDimension) as [SalesDimension, ...SalesDimension[]])
      .default(SalesDimension.MEDICINE),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(orderedRange.check, orderedRange.options);

export const InventoryReportQuerySchema = z.object({
  asOf: reportDate.optional(),
  /** Days without a movement before a batch counts as dead stock. */
  deadStockDays: z.coerce.number().int().min(7).max(365).default(90),
  format: z.enum(['json', 'csv']).default('json'),
});

export const AgeingReportQuerySchema = z.object({
  asOf: reportDate.optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

/**
 * A manager's answer to a cancellation request.
 *
 * `approve: false` is a real answer, not an absence of one: refusing clears the
 * request so the order resumes, and the shop owner is told why. The reason is
 * mandatory in both directions because both are decisions somebody may later
 * have to account for.
 */
export const CancellationDecisionSchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().min(5).max(500),
  version: z.number().int().min(0),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
});
