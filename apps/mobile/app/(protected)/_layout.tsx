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
import { colour } from '../../src/theme';
import { useLanguage } from '../../src/i18n/useLanguage';
import { AskProvider, Toaster } from '../../src/components';

configureForegroundPresentation();

/**
 * The stack that hosts the tab bar.
 *
 * `(tabs)` is the first screen: everything reachable from the bottom bar lives
 * inside it, and everything below — a specific order, a pick list, a delivery's
 * proof capture — is pushed on top, so those screens keep their back button and
 * their place in the history. Making every screen a tab would have taken the
 * back button away from exactly the screens that need it.
 *
 * The role booleans that used to sit here have mostly gone: they were a fourth
 * copy of the permission matrix, after `App.tsx`, `Dashboard.tsx` and web's
 * guards. Tab membership now comes from `@medsupply/navigation`. What remains
 * guards the screens that are *only* reachable by pushing, where there is no
 * tab to omit.
 */
export default function ProtectedLayout() {
  const { t } = useLanguage();
  const role = useAuthStore((state) => state.user?.role);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isOwner = role === UserRole.SHOP_OWNER;
  const isManager =
    role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN || role === UserRole.MANAGER;
  const isDeliveryPerson = role === UserRole.DELIVERY_PERSON;

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

  return (
    /*
     * Both providers sit here rather than in the root layout, because both
     * belong to a signed-in session: there is nothing to confirm and nothing to
     * announce on the sign-in screen. `Toaster` renders after the stack so it
     * draws above it.
     */
    <AskProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colour.surface },
          headerTintColor: colour.text,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

        <Stack.Screen name="medicine-detail" options={{ title: t('screens.medicineDetails') }} />
        <Stack.Screen name="checkout" options={{ title: t('screens.checkout') }} />
        <Stack.Screen name="order-detail" options={{ title: t('screens.orderDetails') }} />
        <Stack.Screen name="approval-review" options={{ title: t('screens.reviewOrder') }} />
        <Stack.Screen name="picking" options={{ title: t('screens.pickingAndPacking') }} />
        <Stack.Screen name="delivery-detail" options={{ title: t('screens.deliveryDetails') }} />
        <Stack.Screen name="delivery-proof" options={{ title: t('screens.proofOfDelivery') }} />
        <Stack.Screen name="return-detail" options={{ title: t('screens.returnDetails') }} />
        <Stack.Screen
          name="notification-preferences"
          options={{ title: t('screens.notificationPreferences') }}
        />

        <Stack.Protected guard={isOwner}>
          <Stack.Screen name="invoices" options={{ title: t('screens.invoices') }} />
          <Stack.Screen name="payments" options={{ title: t('screens.paymentHistory') }} />
          <Stack.Screen name="statement" options={{ title: t('screens.accountStatement') }} />
        </Stack.Protected>
        <Stack.Protected guard={isManager}>
          <Stack.Screen name="overdue-shops" options={{ title: t('screens.overdueShops') }} />
          <Stack.Screen
            name="collection-review"
            options={{ title: t('screens.collectionReview') }}
          />
        </Stack.Protected>
        <Stack.Protected guard={isDeliveryPerson}>
          <Stack.Screen name="collections" options={{ title: t('screens.myCollections') }} />
          <Stack.Screen name="trip" options={{ title: t('trips.myTitle') }} />
        </Stack.Protected>
        <Stack.Protected guard={isOwner || isManager || isDeliveryPerson}>
          <Stack.Screen name="payment-detail" options={{ title: t('screens.paymentDetails') }} />
        </Stack.Protected>
      </Stack>
      <Toaster />
    </AskProvider>
  );
}
