export const financePaymentMethods = [
  'CASH',
  'BANK_TRANSFER',
  'MOBILE_FINANCIAL_SERVICE',
  'CHEQUE',
  'CREDIT',
  'ADVANCE_BALANCE',
  'OTHER',
] as const;
export type FinancePaymentMethod = (typeof financePaymentMethods)[number];

export const financePaymentStatuses = ['PENDING', 'POSTED', 'FAILED', 'REVERSED'] as const;
export type FinancePaymentStatus = (typeof financePaymentStatuses)[number];

export interface FinanceShopSummary {
  _id: string;
  reference: string;
  name: string;
  primaryPhone?: string;
}

export interface FinanceInvoiceSummary {
  _id: string;
  reference: string;
  grandTotalMinor: number;
  paidMinor?: number;
  amountPaidMinor?: number;
  dueMinor?: number;
  amountDueMinor?: number;
  dueDate?: string;
  invoiceDate?: string;
  status?: string;
}

export interface FinanceDeliverySummary {
  _id: string;
  reference: string;
}

export interface FinanceUserSummary {
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

export interface FinanceAttachment {
  _id?: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
}

export interface FinancePayment {
  _id: string;
  reference: string;
  shopId: string | FinanceShopSummary;
  invoiceId?: string | FinanceInvoiceSummary;
  deliveryId?: string | FinanceDeliverySummary;
  amountMinor: number;
  method: FinancePaymentMethod;
  transactionReference?: string;
  collectedBy?: string | FinanceUserSummary;
  receivedBy?: string | FinanceUserSummary;
  collectionTime?: string;
  collectedAt?: string;
  postingTime?: string;
  postedAt?: string;
  status: FinancePaymentStatus;
  source?: 'MANUAL' | 'DELIVERY_COLLECTION' | string;
  notes?: string;
  attachment?: FinanceAttachment;
  attachmentId?: string;
  reversalReference?: string;
  reversalPaymentId?: string | { _id: string; reference: string };
  reversesPaymentId?: string | { _id: string; reference: string };
  version?: number;
  createdAt: string;
}

export interface AccountSummary {
  shopId?: string | FinanceShopSummary;
  creditLimitMinor: number;
  outstandingBalanceMinor: number;
  overdueBalanceMinor: number;
  availableCreditMinor: number;
  creditUtilisationBasisPoints?: number;
  paymentTermsDays?: number;
  creditBlocked?: boolean;
  creditBlockReason?: string;
  asOf?: string;
}

export interface LedgerEntry {
  _id: string;
  reference?: string;
  type: string;
  description?: string;
  sourceReference?: string;
  debitMinor: number;
  creditMinor: number;
  balanceAfterMinor: number;
  postingTime?: string;
  postedAt?: string;
  createdAt?: string;
}

export interface CustomerStatementData {
  shop?: FinanceShopSummary;
  from: string;
  to: string;
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  entries: LedgerEntry[];
}

export interface FinanceReportRow {
  shopId?: string;
  shopReference?: string;
  shopName?: string;
  paymentReference?: string;
  invoiceReference?: string;
  collectorName?: string;
  method?: string;
  status?: string;
  invoiceCount?: number;
  amountMinor?: number;
  outstandingBalanceMinor?: number;
  overdueBalanceMinor?: number;
  collectedAmountMinor?: number;
  dueDate?: string;
  oldestDueDate?: string;
  collectionTime?: string;
  overdueDays?: number;
}

export interface FinanceReportData {
  rows: FinanceReportRow[];
  totalMinor?: number;
  outstandingTotalMinor?: number;
  overdueTotalMinor?: number;
  collectedTotalMinor?: number;
  count?: number;
}

export interface PageMeta {
  page?: number;
  pages?: number;
  total?: number;
  limit?: number;
}

export interface ApiFailure {
  response?: {
    status?: number;
    data?: { error?: { message?: string; details?: Array<{ message?: string }> } };
  };
}

export function populatedName(value?: string | FinanceUserSummary): string {
  return value && typeof value !== 'string' ? `${value.firstName} ${value.lastName}` : '—';
}

export function invoiceDue(invoice: FinanceInvoiceSummary): number {
  return invoice.dueMinor ?? invoice.amountDueMinor ?? invoice.grandTotalMinor;
}
