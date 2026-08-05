import {
  Activity,
  Banknote,
  Bell,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  CircleUser,
  House,
  Package,
  Settings,
  ShieldAlert,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  Undo2,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { NavIcon } from '@medsupply/navigation';

/**
 * The web's answer to `NavItem.icon`.
 *
 * `@medsupply/navigation` has carried a required `icon` on all seventy-one
 * entries since the shell was built — a seventeen-name semantic union, so that
 * "each client resolves it to its own icon set". Mobile did. The web never
 * read the field at all, and rendered a sidebar of thirty-seven identical text
 * rows, which is the hardest possible thing to find anything in.
 *
 * `Record<NavIcon, LucideIcon>`, so a new icon name in the shared package is a
 * compile error here rather than a blank space in the sidebar.
 */
export const NAV_ICON: Record<NavIcon, LucideIcon> = {
  home: House,
  orders: ClipboardList,
  cart: ShoppingCart,
  approvals: ClipboardCheck,
  warehouse: Warehouse,
  delivery: Truck,
  money: Banknote,
  reports: ChartColumn,
  shops: Store,
  catalogue: Package,
  returns: Undo2,
  settings: Settings,
  purchasing: ShoppingBag,
  recall: ShieldAlert,
  bell: Bell,
  activity: Activity,
  account: CircleUser,
};
