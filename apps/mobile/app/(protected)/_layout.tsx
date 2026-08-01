import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { UserRole } from '@medsupply/shared-types';
import { useAuthStore } from '../../src/store/useAuth';
import {
  configureForegroundPresentation,
  registerForPush,
  routeForPush,
  type PushPayload,
} from '../../src/notifications/push';
import { connectRealtime, disconnectRealtime } from '../../src/notifications/realtime';

configureForegroundPresentation();

export default function ProtectedLayout() {
  const role = useAuthStore((state) => state.user?.role);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAdministrator = role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;

  // One realtime connection and one push registration per signed-in session.
  useEffect(() => {
    if (!isAuthenticated) return;
    connectRealtime();
    void registerForPush();
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const payload = response.notification.request.content.data as PushPayload | undefined;
        const path = routeForPush(payload);
        if (path) router.push(path as never);
      },
    );
    return () => {
      responseSubscription.remove();
      disconnectRealtime();
    };
  }, [isAuthenticated]);

  const isOwner = role === UserRole.SHOP_OWNER;
  const isManager =
    role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN || role === UserRole.MANAGER;
  const isDeliveryPerson = role === UserRole.DELIVERY_PERSON;

  return (
    <Stack>
      <Stack.Screen name="dashboard" options={{ title: 'Dashboard' }} />
      <Stack.Screen name="medicines" options={{ title: 'Medicines' }} />
      <Stack.Screen name="medicine-detail" options={{ title: 'Medicine details' }} />
      <Stack.Screen name="inventory" options={{ title: 'Inventory' }} />
      <Stack.Screen name="cart" options={{ title: 'Cart' }} />
      <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
      <Stack.Screen name="orders" options={{ title: 'Orders' }} />
      <Stack.Screen name="order-detail" options={{ title: 'Order details' }} />
      <Stack.Screen name="approvals" options={{ title: 'Approvals' }} />
      <Stack.Screen name="approval-review" options={{ title: 'Review order' }} />
      <Stack.Screen name="fulfilment" options={{ title: 'Fulfilment queue' }} />
      <Stack.Screen name="picking" options={{ title: 'Picking and packing' }} />
      <Stack.Screen name="ready" options={{ title: 'Ready for delivery' }} />
      <Stack.Screen name="deliveries" options={{ title: 'My deliveries' }} />
      <Stack.Screen name="delivery-detail" options={{ title: 'Delivery details' }} />
      <Stack.Screen name="delivery-proof" options={{ title: 'Proof of delivery' }} />
      <Stack.Screen name="returns" options={{ title: 'Returns' }} />
      <Stack.Screen name="return-detail" options={{ title: 'Return details' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      {/* Every role can see and end its own sign-ins. */}
      <Stack.Screen name="security" options={{ title: 'Security' }} />
      <Stack.Screen
        name="notification-preferences"
        options={{ title: 'Notification preferences' }}
      />
      <Stack.Protected guard={isOwner}>
        <Stack.Screen name="account" options={{ title: 'Account and credit' }} />
        <Stack.Screen name="invoices" options={{ title: 'Invoices' }} />
        <Stack.Screen name="payments" options={{ title: 'Payment history' }} />
        <Stack.Screen name="statement" options={{ title: 'Account statement' }} />
      </Stack.Protected>
      <Stack.Protected guard={isManager}>
        <Stack.Screen name="finance-dashboard" options={{ title: 'Due and collections' }} />
        <Stack.Screen name="overdue-shops" options={{ title: 'Overdue shops' }} />
        <Stack.Screen name="collection-review" options={{ title: 'Collection review' }} />
      </Stack.Protected>
      <Stack.Protected guard={isManager}>
        <Stack.Screen name="analytics" options={{ title: 'Business analytics' }} />
      </Stack.Protected>
      <Stack.Protected guard={isAdministrator}>
        <Stack.Screen name="system-settings" options={{ title: 'System settings' }} />
      </Stack.Protected>
      <Stack.Protected guard={isDeliveryPerson}>
        <Stack.Screen name="collections" options={{ title: 'My collections' }} />
      </Stack.Protected>
      <Stack.Protected guard={isOwner || isManager || isDeliveryPerson}>
        <Stack.Screen name="payment-detail" options={{ title: 'Payment details' }} />
      </Stack.Protected>
    </Stack>
  );
}
