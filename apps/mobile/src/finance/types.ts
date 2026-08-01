export const FinancePaymentMethod = {
  CASH: 'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
  MOBILE_FINANCIAL_SERVICE: 'MOBILE_FINANCIAL_SERVICE',
  CHEQUE: 'CHEQUE',
  CREDIT: 'CREDIT',
  ADVANCE_BALANCE: 'ADVANCE_BALANCE',
  OTHER: 'OTHER',
} as const;

export type FinancePaymentMethod = (typeof FinancePaymentMethod)[keyof typeof FinancePaymentMethod];

export const FinancePaymentStatus = {
  PENDING: 'PENDING',
  POSTED: 'POSTED',
  FAILED: 'FAILED',
  REVERSED: 'REVERSED',
} as const;

export type FinancePaymentStatus = (typeof FinancePaymentStatus)[keyof typeof FinancePaymentStatus];

export type ReferenceSnapshot = {
  _id: string;
  reference: string;
  name?: string;
};

export type FinanceInvoice = {
  _id: string;
  reference: string;
  status: string;
  invoiceDate: string;
  dueDate: string;
  grandTotalMinor: number;
  amountPaidMinor: number;
  amountDueMinor: number;
  orderId?: string | ReferenceSnapshot;
};

export type FinancePayment = {
  _id: string;
  reference: string;
  shopId?: string | ReferenceSnapshot;
  invoiceId?: string | ReferenceSnapshot;
  deliveryId?: string | ReferenceSnapshot;
  amountMinor: number;
  method: FinancePaymentMethod;
  status: FinancePaymentStatus;
  source?: 'MANUAL' | 'DELIVERY_COLLECTION' | string;
  transactionReference?: string;
  receiptReference?: string;
  collectionTime?: string;
  postingTime?: string;
  notes?: string;
  attachmentFileId?: string;
  reversalReference?: string;
  handoverStatus?: 'NOT_REQUIRED' | 'PENDING' | 'HANDED_OVER' | 'RECEIVED' | string;
  createdAt: string;
};

export type ShopFinanceSummary = {
  shop: {
    _id: string;
    reference: string;
    name: string;
    status: string;
  };
  creditLimitMinor: number;
  outstandingBalanceMinor: number;
  availableCreditMinor: number;
  overdueBalanceMinor: number;
  creditUtilisationBps: number;
  paymentTermsDays: number;
  creditBlocked: boolean;
  blockReason?: string;
};

export type StatementEntry = {
  _id: string;
  date: string;
  reference: string;
  type: string;
  description: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
};

export type CustomerStatement = {
  from: string;
  to: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  entries: StatementEntry[];
};

export type FinanceReportSummary = {
  totalOutstandingMinor: number;
  totalOverdueMinor: number;
  pendingCollectionsMinor: number;
  pendingCollectionsCount: number;
  overdueShopCount: number;
};

export type OverdueShop = {
  shopId: string;
  reference: string;
  name: string;
  outstandingBalanceMinor: number;
  overdueBalanceMinor: number;
  oldestDueDate: string;
  daysOverdue: number;
};

export type CollectionSummary = {
  todayCollectedMinor: number;
  pendingHandoverMinor: number;
  pendingHandoverCount?: number;
};

export type Paginated<T> = {
  items: T[];
  page: number;
  pages: number;
  total: number;
};

export type Receipt = {
  receiptReference: string;
  paymentReference: string;
  shopName: string;
  invoiceReference?: string;
  amountMinor: number;
  method: FinancePaymentMethod;
  postedAt?: string;
};
