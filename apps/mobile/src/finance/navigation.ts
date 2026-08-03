import { UserRole } from '@medsupply/shared-types';

export type FinanceRoute =
  | '/(protected)/(tabs)/account'
  | '/(protected)/invoices'
  | '/(protected)/payments'
  | '/(protected)/statement'
  | '/(protected)/(tabs)/finance-dashboard'
  | '/(protected)/overdue-shops'
  | '/(protected)/collection-review'
  | '/(protected)/collections';

export type FinanceNavigationItem = {
  label: string;
  route: FinanceRoute;
};

const ownerItems: FinanceNavigationItem[] = [
  { label: 'Account and credit', route: '/(protected)/(tabs)/account' },
  { label: 'Invoices', route: '/(protected)/invoices' },
  { label: 'Payment history', route: '/(protected)/payments' },
  { label: 'Account statement', route: '/(protected)/statement' },
];

const managerItems: FinanceNavigationItem[] = [
  { label: 'Due and collections', route: '/(protected)/(tabs)/finance-dashboard' },
  { label: 'Overdue shops', route: '/(protected)/overdue-shops' },
  { label: 'Collection review', route: '/(protected)/collection-review' },
];

const deliveryItems: FinanceNavigationItem[] = [
  { label: 'My collections', route: '/(protected)/collections' },
];

export function getFinanceNavigation(role?: UserRole): FinanceNavigationItem[] {
  if (role === UserRole.SHOP_OWNER) return ownerItems;
  if (role === UserRole.MANAGER || role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN) {
    return managerItems;
  }
  if (role === UserRole.DELIVERY_PERSON) return deliveryItems;
  return [];
}
