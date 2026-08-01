import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { ShopList } from './pages/ShopList';
import { ShopDetail } from './pages/ShopDetail';
import { ShopForm } from './pages/ShopForm';
import { ProtectedRoute } from './components/ProtectedRoute';
import { UserRole } from '@medsupply/shared-types';
import { MedicineList } from './pages/MedicineList';
import { MedicineForm } from './pages/MedicineForm';
import { MedicineDetail } from './pages/MedicineDetail';
import { InventoryDashboard } from './pages/InventoryDashboard';
import { Cart } from './pages/Cart';
import { Checkout } from './pages/Checkout';
import { OrderList } from './pages/OrderList';
import { OrderDetail } from './pages/OrderDetail';
import { ApprovalQueue } from './pages/ApprovalQueue';
import { ApprovalReview } from './pages/ApprovalReview';
import { FulfilmentQueue } from './pages/FulfilmentQueue';
import { FulfilmentWork } from './pages/FulfilmentWork';
import { ReadyQueue } from './pages/ReadyQueue';
import { DeliveryBoard } from './pages/DeliveryBoard';
import { DeliveryDetail } from './pages/DeliveryDetail';
import { PaymentList } from './pages/PaymentList';
import { RecordPayment } from './pages/RecordPayment';
import { PaymentDetail } from './pages/PaymentDetail';
import { CollectionReview } from './pages/CollectionReview';
import { CustomerLedger } from './pages/CustomerLedger';
import { CustomerStatement } from './pages/CustomerStatement';
import { CollectionReport, OutstandingReport, OverdueReport } from './pages/FinancialReports';
import { ShopAccount } from './pages/ShopAccount';
import { Unauthorized } from './pages/Unauthorized';
import { Notifications } from './pages/Notifications';
import { NotificationPreferences } from './pages/NotificationPreferences';
import { ActivityFeed } from './pages/ActivityFeed';
import { SystemSettings } from './pages/SystemSettings';
import { UserAdministration } from './pages/UserAdministration';
import { AuditLogViewer } from './pages/AuditLogViewer';
import { ReturnList } from './pages/ReturnList';
import { ReturnRequest } from './pages/ReturnRequest';
import { ReturnDetail } from './pages/ReturnDetail';
import { AnalyticsDashboard } from './pages/AnalyticsDashboard';
import { SecurityCentre } from './pages/SecurityCentre';
import {
  DeliveryAnalytics,
  InventoryAnalytics,
  ReceivablesAnalytics,
  ReturnsAnalytics,
  SalesAnalytics,
} from './pages/AnalyticsReports';

const financeRoles = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/unauthorized" element={<Unauthorized />} />

        {/* Admin / Manager routes */}
        <Route
          element={
            <ProtectedRoute
              allowedRoles={[UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER]}
            />
          }
        >
          <Route path="/shops" element={<ShopList />} />
          <Route path="/shops/new" element={<ShopForm />} />
          <Route path="/shops/:id" element={<ShopDetail />} />
          <Route path="/approvals" element={<ApprovalQueue />} />
          <Route path="/approvals/:id" element={<ApprovalReview />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={Object.values(UserRole)} />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/notifications/preferences" element={<NotificationPreferences />} />
          <Route path="/activity" element={<ActivityFeed />} />
          {/* Every role can see and end its own sign-ins. */}
          <Route path="/account/security" element={<SecurityCentre />} />
        </Route>

        <Route
          element={
            <ProtectedRoute
              allowedRoles={[
                UserRole.SUPER_ADMIN,
                UserRole.ADMIN,
                UserRole.MANAGER,
                UserRole.STOREKEEPER,
                UserRole.SHOP_OWNER,
              ]}
            />
          }
        >
          <Route path="/medicines" element={<MedicineList />} />
          <Route path="/medicines/:id" element={<MedicineDetail />} />
          <Route path="/orders" element={<OrderList />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/deliveries" element={<DeliveryBoard />} />
          <Route path="/deliveries/:id" element={<DeliveryDetail />} />
        </Route>
        {/* Returns pass through the shop, management, the warehouse and a
            delivery person, so the list and detail views are open to all of
            them; the service narrows a Shop Owner to their own records. */}
        <Route
          element={
            <ProtectedRoute
              allowedRoles={[
                UserRole.SUPER_ADMIN,
                UserRole.ADMIN,
                UserRole.MANAGER,
                UserRole.STOREKEEPER,
                UserRole.DELIVERY_PERSON,
                UserRole.SHOP_OWNER,
              ]}
            />
          }
        >
          <Route path="/returns" element={<ReturnList />} />
          <Route path="/returns/:id" element={<ReturnDetail />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={[UserRole.SHOP_OWNER]} />}>
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/returns/new" element={<ReturnRequest />} />
          <Route path="/account" element={<ShopAccount />} />
          <Route path="/account/payments" element={<PaymentList ownerMode />} />
          <Route path="/account/payments/:id" element={<PaymentDetail ownerMode />} />
          <Route path="/account/statement" element={<CustomerStatement ownerMode />} />
        </Route>
        <Route
          element={
            <ProtectedRoute
              allowedRoles={[UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER]}
            />
          }
        >
          <Route path="/medicines/new" element={<MedicineForm />} />
        </Route>
        <Route
          element={
            <ProtectedRoute
              allowedRoles={[
                UserRole.SUPER_ADMIN,
                UserRole.ADMIN,
                UserRole.MANAGER,
                UserRole.STOREKEEPER,
              ]}
            />
          }
        >
          <Route path="/inventory" element={<InventoryDashboard />} />
          <Route path="/fulfilment" element={<FulfilmentQueue />} />
          <Route path="/fulfilment/:id" element={<FulfilmentWork />} />
          <Route path="/fulfilment/ready" element={<ReadyQueue />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={[UserRole.SUPER_ADMIN, UserRole.ADMIN]} />}>
          <Route path="/admin/settings" element={<SystemSettings />} />
          <Route path="/admin/audit" element={<AuditLogViewer />} />
        </Route>
        <Route
          element={
            <ProtectedRoute
              allowedRoles={[UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER]}
            />
          }
        >
          <Route path="/admin/users" element={<UserAdministration />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={financeRoles} />}>
          <Route path="/payments" element={<PaymentList />} />
          <Route path="/payments/new" element={<RecordPayment />} />
          <Route path="/payments/collections" element={<CollectionReview />} />
          <Route path="/payments/:id" element={<PaymentDetail />} />
          <Route path="/shops/:shopId/ledger" element={<CustomerLedger />} />
          <Route path="/shops/:shopId/statement" element={<CustomerStatement />} />
          <Route path="/reports/outstanding" element={<OutstandingReport />} />
          <Route path="/reports/overdue" element={<OverdueReport />} />
          <Route path="/reports/collections" element={<CollectionReport />} />
          <Route path="/analytics" element={<AnalyticsDashboard />} />
          <Route path="/analytics/deliveries" element={<DeliveryAnalytics />} />
          <Route path="/analytics/receivables" element={<ReceivablesAnalytics />} />
        </Route>

        <Route element={<ProtectedRoute allowedRoles={[...financeRoles, UserRole.STOREKEEPER]} />}>
          <Route path="/analytics/inventory" element={<InventoryAnalytics />} />
        </Route>

        {/* A Shop Owner sees the same sales and returns reports, narrowed by
            the API to the shops they own. */}
        <Route element={<ProtectedRoute allowedRoles={[...financeRoles, UserRole.SHOP_OWNER]} />}>
          <Route path="/analytics/sales" element={<SalesAnalytics />} />
          <Route path="/analytics/returns" element={<ReturnsAnalytics />} />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
