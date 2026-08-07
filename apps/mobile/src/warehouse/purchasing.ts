import type { GoodsReceipt, PurchaseOrder, Supplier, Warehouse } from '@medsupply/shared-types';
import { apiClient } from '../api/client';

/**
 * Buying in, and booking it in at the door.
 *
 * `POST /purchasing/orders/{id}/receipts` is the one that matters here: a
 * delivery arrives on a lorry, somebody opens the cartons and writes down what
 * is actually in them, and until now that person had to go and find a desktop.
 * A batch number and an expiry date read off a carton and typed twice is a
 * transcription with an expiry date in it.
 */

type Envelope<T> = { data: T; meta?: { page?: number; pages?: number; total?: number } };

export async function getSuppliers(params: Record<string, string> = {}) {
  const response = await apiClient.get<Envelope<Supplier[]>>('/purchasing/suppliers', { params });
  return response.data.data;
}

export async function createSupplier(body: {
  name: string;
  primaryPhone: string;
  contactName?: string;
  drugLicenceNumber?: string;
  paymentTermsDays?: number;
}) {
  const response = await apiClient.post<Envelope<Supplier>>('/purchasing/suppliers', body);
  return response.data.data;
}

export async function getPurchaseOrders(params: Record<string, string> = {}) {
  const response = await apiClient.get<Envelope<PurchaseOrder[]>>('/purchasing/orders', { params });
  return response.data.data;
}

export async function getPurchaseOrder(id: string) {
  const response = await apiClient.get<
    Envelope<{ order: PurchaseOrder; receipts: GoodsReceipt[] }>
  >(`/purchasing/orders/${id}`);
  return response.data.data;
}

export interface OrderLineDraft {
  medicineId: string;
  orderedQuantity: number;
  unitCostMinor: number;
}

export async function createPurchaseOrder(body: {
  supplierId: string;
  lines: OrderLineDraft[];
  expectedDate?: string;
  supplierReference?: string;
}) {
  const response = await apiClient.post<Envelope<PurchaseOrder>>('/purchasing/orders', body);
  return response.data.data;
}

/** One carton's worth of what actually arrived. */
export interface ReceiptLineDraft {
  purchaseOrderLineId: string;
  batchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  receivedQuantity: number;
  warehouseLocation: string;
  varianceReason?: string;
}

export async function receiveGoods(
  purchaseOrderId: string,
  body: { supplierInvoiceReference?: string; lines: ReceiptLineDraft[] },
) {
  const response = await apiClient.post<Envelope<GoodsReceipt>>(
    `/purchasing/orders/${purchaseOrderId}/receipts`,
    body,
  );
  return response.data.data;
}

export async function getWarehouses() {
  const response = await apiClient.get<Envelope<Warehouse[]>>('/inventory/warehouses');
  return response.data.data;
}

export async function createWarehouse(body: {
  code: string;
  name: string;
  contactPhone?: string;
  makeDefault?: boolean;
}) {
  const response = await apiClient.post<Envelope<Warehouse>>('/inventory/warehouses', body);
  return response.data.data;
}

/** What is wrong with a receipt line, as a catalogue key rather than a sentence. */
export type ReceiptProblem =
  | { key: 'purchasing.batchRequired'; values?: undefined }
  | { key: 'purchasing.placeRequired'; values?: undefined }
  | { key: 'purchasing.quantityRequired'; values?: undefined }
  | { key: 'purchasing.expiryRequired'; values?: undefined }
  | { key: 'purchasing.expiredOnArrival'; values?: undefined }
  | { key: 'purchasing.expiryBeforeMade'; values?: undefined }
  | { key: 'purchasing.moreThanOrdered'; values: { outstanding: number } }
  | { key: 'purchasing.shortNeedsReason'; values?: undefined };

/**
 * Whether a line somebody typed at the goods-in door can be booked in.
 *
 * The order is the order somebody fills the form in, so the first thing they
 * are told about is the first thing they can fix — the same rule the password
 * and address forms follow.
 *
 * **Two of these are the reason this screen is worth having.** A batch that has
 * already expired must not be received into saleable stock at all; and
 * accepting less than was ordered without saying why turns a supplier's short
 * delivery into what looks like a counting error three weeks later.
 */
export function receiptProblem(
  line: { orderedQuantity: number; receivedQuantity: number },
  draft: {
    batchNumber: string;
    warehouseLocation: string;
    receivedQuantity: string;
    manufacturingDate: string;
    expiryDate: string;
    varianceReason: string;
  },
  now = new Date(),
): ReceiptProblem | null {
  if (draft.batchNumber.trim().length === 0) return { key: 'purchasing.batchRequired' };
  if (draft.warehouseLocation.trim().length === 0) return { key: 'purchasing.placeRequired' };

  const quantity = Number(draft.receivedQuantity.trim());
  if (!Number.isInteger(quantity) || quantity <= 0) return { key: 'purchasing.quantityRequired' };

  const expiry = new Date(draft.expiryDate);
  if (Number.isNaN(expiry.getTime())) return { key: 'purchasing.expiryRequired' };
  if (expiry <= now) return { key: 'purchasing.expiredOnArrival' };

  const made = new Date(draft.manufacturingDate);
  if (!Number.isNaN(made.getTime()) && made >= expiry) {
    // Almost always a year typed into the wrong field, and it is worth catching
    // here rather than as a rejected request after four more lines.
    return { key: 'purchasing.expiryBeforeMade' };
  }

  const outstanding = line.orderedQuantity - line.receivedQuantity;
  if (quantity > outstanding) return { key: 'purchasing.moreThanOrdered', values: { outstanding } };
  if (quantity < outstanding && draft.varianceReason.trim().length === 0) {
    return { key: 'purchasing.shortNeedsReason' };
  }
  return null;
}

/** How much of a line is still to come. */
export function outstandingOn(line: { orderedQuantity: number; receivedQuantity: number }) {
  return Math.max(0, line.orderedQuantity - line.receivedQuantity);
}

/** Whether an order still has anything to book in. */
export function stillArriving(order: Pick<PurchaseOrder, 'status' | 'lines'>) {
  if (order.status !== 'ISSUED' && order.status !== 'PARTIALLY_RECEIVED') return false;
  return order.lines.some((line) => outstandingOn(line) > 0);
}
