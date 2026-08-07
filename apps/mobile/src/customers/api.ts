import type { Shop } from '@medsupply/shared-types';
import { apiClient } from '../api/client';

/**
 * The distributor's customers, from a phone.
 *
 * The screen a representative needs standing at a counter, and the one a
 * manager needs when a shop rings. Both were desktop-only, which is the wrong
 * way round for the two roles that spend least time at a desk.
 */

type Envelope<T> = { data: T; meta?: { page?: number; pages?: number; total?: number } };

export async function getShops(params: Record<string, string> = {}) {
  const response = await apiClient.get<Envelope<Shop[]>>('/shops', { params });
  return { items: response.data.data, total: response.data.meta?.total ?? 0 };
}

export async function getShop(id: string) {
  const response = await apiClient.get<Envelope<Shop>>(`/shops/${id}`);
  return response.data.data;
}

export async function setShopStatus(id: string, status: string, reason: string) {
  const response = await apiClient.patch<Envelope<Shop>>(`/shops/${id}/status`, { status, reason });
  return response.data.data;
}

export interface CreditSummary {
  outstandingBalanceMinor: number;
  overdueBalanceMinor: number;
  creditLimitMinor: number;
  availableCreditMinor: number;
  creditBlocked?: boolean;
  oldestDueDate?: string;
}

/**
 * What one customer owes.
 *
 * Opened to `SALES` in this phase, scoped by territory on the server. The
 * ledger, the invoices and the statement below stay management-only: those are
 * the documents a conversation about money is had from, and a representative
 * quoting them is having a manager's conversation.
 */
export async function getShopCredit(shopId: string) {
  const response = await apiClient.get<Envelope<CreditSummary>>(`/finance/shops/${shopId}/summary`);
  return response.data.data;
}

/**
 * One movement on a customer's account.
 *
 * `description` is what the server wrote when it posted the entry, and it is
 * what this client shows. The web ledger renders `type.replaceAll('_', ' ')`
 * instead — a lowercased enum, which is the defect the status pills removed
 * everywhere else and is recorded in `ASSUMPTIONS.md` rather than fixed here.
 */
export interface LedgerEntry {
  _id: string;
  type: string;
  description?: string;
  reference?: string;
  sourceReference?: string;
  debitMinor?: number;
  creditMinor?: number;
  balanceAfterMinor?: number;
  postingTime?: string;
  postedAt?: string;
  createdAt?: string;
}

export async function getShopLedger(shopId: string, page = 1) {
  const response = await apiClient.get<Envelope<LedgerEntry[]>>(`/finance/shops/${shopId}/ledger`, {
    params: { page, limit: 50 },
  });
  return { items: response.data.data, pages: response.data.meta?.pages ?? 1 };
}

export interface ShopInvoiceRow {
  _id: string;
  reference: string;
  invoiceDate: string;
  dueDate: string;
  grandTotalMinor: number;
  amountDueMinor: number;
}

export async function getShopInvoices(shopId: string) {
  const response = await apiClient.get<Envelope<ShopInvoiceRow[]>>(
    `/finance/shops/${shopId}/invoices`,
  );
  return response.data.data;
}

export async function getShopStatement(shopId: string, from: string, to: string) {
  const response = await apiClient.get<Envelope<Record<string, unknown>>>(
    `/finance/shops/${shopId}/statement`,
    { params: { from, to } },
  );
  return response.data.data;
}

/**
 * Whether a role may open a customer's ledger and statement.
 *
 * Written here rather than inferred at each call site, so the screens and the
 * server agree in one place. The server refuses either way — this only decides
 * whether a button is worth showing, and a button that always 403s is worse
 * than no button.
 */
export function mayReadLedger(role: string | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER';
}
