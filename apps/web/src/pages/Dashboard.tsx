import { Link } from 'react-router-dom';
import { UserRole } from '@medsupply/shared-types';
import { useAuthStore } from '../store/useAuth';
import './inventory.css';

const financeRoles: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];

export function Dashboard() {
  const user = useAuthStore((state) => state.user);
  const canManageFinance = user ? financeRoles.includes(user.role) : false;
  const isAdministrator = user?.role === UserRole.SUPER_ADMIN || user?.role === UserRole.ADMIN;
  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">MedSupply B2B</p>
          <h1>Dashboard</h1>
          <p>Welcome back, {user?.firstName ?? 'team member'}.</p>
        </div>
      </header>
      <section className="catalogue-grid dashboard-links">
        {user?.role === UserRole.SHOP_OWNER ? (
          <>
            <Link className="medicine-card" to="/account">
              <h2>Account and credit</h2>
              <p>Current due, available credit, invoices and payments.</p>
            </Link>
            <Link className="medicine-card" to="/medicines">
              <h2>Medicines</h2>
              <p>Browse the catalogue and prepare an order.</p>
            </Link>
            <Link className="medicine-card" to="/cart">
              <h2>Cart</h2>
              <p>Review your current order request.</p>
            </Link>
            <Link className="medicine-card" to="/orders">
              <h2>Orders</h2>
              <p>Track submitted and completed orders.</p>
            </Link>
            <Link className="medicine-card" to="/returns">
              <h2>Returns</h2>
              <p>Request a return against a delivered invoice and follow its credit note.</p>
            </Link>
            <Link className="medicine-card" to="/analytics/sales">
              <h2>My purchasing</h2>
              <p>What you have bought and returned over time.</p>
            </Link>
          </>
        ) : null}
        {canManageFinance ? (
          <>
            <Link className="medicine-card" to="/payments">
              <h2>Payments</h2>
              <p>Record, post, inspect and reverse customer payments.</p>
            </Link>
            <Link className="medicine-card" to="/payments/collections">
              <h2>Collection review</h2>
              <p>Verify Delivery Person collections before ledger posting.</p>
            </Link>
            <Link className="medicine-card" to="/reports/outstanding">
              <h2>Financial reports</h2>
              <p>Outstanding, overdue and collection reporting.</p>
            </Link>
            <Link className="medicine-card" to="/analytics">
              <h2>Business analytics</h2>
              <p>Sales, order pipeline, delivery performance, returns and receivables ageing.</p>
            </Link>
            <Link className="medicine-card" to="/returns">
              <h2>Customer returns</h2>
              <p>Review, receive and credit returned goods.</p>
            </Link>
            <Link className="medicine-card" to="/shops">
              <h2>Customers</h2>
              <p>Shop details, credit controls, ledgers and statements.</p>
            </Link>
          </>
        ) : null}
        {user?.role === UserRole.STOREKEEPER ? (
          <>
            <Link className="medicine-card" to="/fulfilment">
              <h2>Fulfilment queue</h2>
              <p>Pick and pack approved orders.</p>
            </Link>
            <Link className="medicine-card" to="/inventory">
              <h2>Inventory</h2>
              <p>Receive and manage batch stock.</p>
            </Link>
            <Link className="medicine-card" to="/returns">
              <h2>Returns to receive</h2>
              <p>Book in and inspect returned goods.</p>
            </Link>
            <Link className="medicine-card" to="/analytics/inventory">
              <h2>Inventory report</h2>
              <p>Valuation, expiry exposure, low stock and dead stock.</p>
            </Link>
          </>
        ) : null}
        {user?.role === UserRole.DELIVERY_PERSON ? (
          <Link className="medicine-card" to="/returns">
            <h2>Returns to collect</h2>
            <p>Approved returns waiting for pickup from the shop.</p>
          </Link>
        ) : null}
        {isAdministrator ? (
          <>
            <Link className="medicine-card" to="/admin/settings">
              <h2>System settings</h2>
              <p>
                Business identity, finance, inventory, delivery, notification and security policy.
              </p>
            </Link>
            <Link className="medicine-card" to="/admin/audit">
              <h2>Audit log</h2>
              <p>Append-only history of every sensitive operation.</p>
            </Link>
          </>
        ) : null}
        {canManageFinance ? (
          <Link className="medicine-card" to="/admin/users">
            <h2>Users and roles</h2>
            <p>Accounts, roles, status, password resets and sessions.</p>
          </Link>
        ) : null}
        <Link className="medicine-card" to="/notifications">
          <h2>Notifications</h2>
          <p>Everything the system has told you, with per-channel preferences.</p>
        </Link>
        <Link className="medicine-card" to="/activity">
          <h2>Activity feed</h2>
          <p>Live business events across orders, fulfilment, delivery and finance.</p>
        </Link>
        <Link className="medicine-card" to="/account/security">
          <h2>Security centre</h2>
          <p>Where your account is signed in, and how to end a session you do not recognise.</p>
        </Link>
      </section>
    </main>
  );
}
