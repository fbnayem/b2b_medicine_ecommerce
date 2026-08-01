import { apiClient } from '../api/client';
import type {
  CollectionSummary,
  CustomerStatement,
  FinanceInvoice,
  FinancePayment,
  FinanceReportSummary,
  OverdueShop,
  Paginated,
  Receipt,
  ShopFinanceSummary,
} from './types';

type Meta = { page?: number; pages?: number; total?: number; summary?: CollectionSummary };
type Envelope<T> = { data: T; meta?: Meta };

function paginated<T>(payload: T[] | { items: T[] }, meta?: Meta): Paginated<T> {
  const items = Array.isArray(payload) ? payload : payload.items;
  return {
    items,
    page: meta?.page ?? 1,
    pages: meta?.pages ?? 1,
    total: meta?.total ?? items.length,
  };
}

export async function getMyFinanceSummary() {
  const response = await apiClient.get<Envelope<ShopFinanceSummary>>('/finance/my/summary');
  return response.data.data;
}

export async function getMyInvoices(page = 1, limit = 30) {
  const response = await apiClient.get<Envelope<FinanceInvoice[] | { items: FinanceInvoice[] }>>(
    '/finance/my/invoices',
    { params: { page, limit } },
  );
  return paginated(response.data.data, response.data.meta);
}

export async function getPayments(params: Record<string, string | number> = {}) {
  const response = await apiClient.get<Envelope<FinancePayment[] | { items: FinancePayment[] }>>(
    '/payments',
    { params },
  );
  return paginated(response.data.data, response.data.meta);
}

export async function getPayment(id: string) {
  const response = await apiClient.get<Envelope<FinancePayment>>(`/payments/${id}`);
  return response.data.data;
}

export async function getPaymentReceipt(id: string) {
  const response = await apiClient.get<Envelope<Receipt>>(`/payments/${id}/receipt`, {
    params: { format: 'json' },
  });
  return response.data.data;
}

export async function getMyStatement(from: string, to: string) {
  const response = await apiClient.get<Envelope<CustomerStatement>>('/finance/my/statement', {
    params: { from, to },
  });
  return response.data.data;
}

export async function getFinanceReportSummary() {
  const response = await apiClient.get<Envelope<FinanceReportSummary>>('/finance/reports/summary');
  return response.data.data;
}

export async function getOverdueShops() {
  const response = await apiClient.get<Envelope<OverdueShop[] | { items: OverdueShop[] }>>(
    '/finance/reports/overdue',
  );
  return paginated(response.data.data, response.data.meta);
}

export async function postPayment(id: string, idempotencyKey: string) {
  const response = await apiClient.post<Envelope<FinancePayment>>(`/payments/${id}/post`, {
    idempotencyKey,
  });
  return response.data.data;
}

export async function failPayment(id: string, reason: string, idempotencyKey: string) {
  const response = await apiClient.post<Envelope<FinancePayment>>(`/payments/${id}/fail`, {
    reason,
    idempotencyKey,
  });
  return response.data.data;
}

export async function getMyCollections(page = 1, limit = 30) {
  const response = await apiClient.get<
    Envelope<FinancePayment[] | { items: FinancePayment[]; summary?: CollectionSummary }>
  >('/finance/my/collections', { params: { page, limit } });
  const collection = paginated(response.data.data, response.data.meta);
  const payloadSummary = Array.isArray(response.data.data) ? undefined : response.data.data.summary;
  return {
    ...collection,
    summary: payloadSummary ??
      response.data.meta?.summary ?? {
        todayCollectedMinor: 0,
        pendingHandoverMinor: 0,
      },
  };
}

export async function handoverPayment(id: string, idempotencyKey: string) {
  const response = await apiClient.post<Envelope<FinancePayment>>(`/payments/${id}/handover`, {
    idempotencyKey,
  });
  return response.data.data;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  const value = error as { response?: { data?: { error?: { message?: string } } } };
  return value.response?.data?.error?.message ?? fallback;
}
