import { OrderStatus, ShopStatus } from '@medsupply/shared-types';
export function assertShopMaySubmit(status: ShopStatus) {
  if (status !== ShopStatus.ACTIVE)
    throw new Error(`Orders cannot be submitted while shop status is ${status}`);
}
export function mayEditOrder(status: OrderStatus) {
  return status === OrderStatus.DRAFT;
}
export function mayRequestCancellation(status: OrderStatus) {
  return (
    [OrderStatus.SUBMITTED, OrderStatus.UNDER_REVIEW, OrderStatus.ON_HOLD] as OrderStatus[]
  ).includes(status);
}
