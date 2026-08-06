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
  /**
   * The catalogue key. These were English string literals rendered straight
   * onto the home screen, so four of the six destinations a shop owner has
   * stayed in English when the language was switched — the same defect
   * `navigation/tabs.ts` records for the tab bar, one screen along.
   */
  labelKey: string;
  /** What to show if the catalogue has no such key. */
  label: string;
  route: FinanceRoute;
};

const ownerItems: FinanceNavigationItem[] = [
  { labelKey: 'account.title', label: 'Your account', route: '/(protected)/(tabs)/account' },
  { labelKey: 'screens.invoices', label: 'Invoices', route: '/(protected)/invoices' },
  { labelKey: 'screens.paymentHistory', label: 'Payment history', route: '/(protected)/payments' },
  {
    labelKey: 'screens.accountStatement',
    label: 'Account statement',
    route: '/(protected)/statement',
  },
];

const managerItems: FinanceNavigationItem[] = [
  {
    labelKey: 'finance.dueAndCollections',
    label: 'Due and collections',
    route: '/(protected)/(tabs)/finance-dashboard',
  },
  { labelKey: 'screens.overdueShops', label: 'Overdue shops', route: '/(protected)/overdue-shops' },
  {
    labelKey: 'screens.collectionReview',
    label: 'Collection review',
    route: '/(protected)/collection-review',
  },
];

const deliveryItems: FinanceNavigationItem[] = [
  { labelKey: 'screens.myCollections', label: 'My collections', route: '/(protected)/collections' },
];

export function getFinanceNavigation(role?: UserRole): FinanceNavigationItem[] {
  if (role === UserRole.SHOP_OWNER) return ownerItems;
  if (role === UserRole.MANAGER || role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN) {
    return managerItems;
  }
  if (role === UserRole.DELIVERY_PERSON) return deliveryItems;
  return [];
}
