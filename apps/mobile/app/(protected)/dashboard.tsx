import { useCallback, useEffect, useState } from 'react';
import { Text, Button, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useAuthStore } from '../../src/store/useAuth';
import { router, useFocusEffect } from 'expo-router';
import { RealtimeEvent, UserRole, type UnreadNotificationSummary } from '@medsupply/shared-types';
import { getFinanceNavigation } from '../../src/finance/navigation';
import { fetchUnreadSummary } from '../../src/notifications/api';
import { disconnectRealtime, onRealtime } from '../../src/notifications/realtime';
import { unregisterCurrentDevice } from '../../src/notifications/push';

const emptyUnread: UnreadNotificationSummary = {
  total: 0,
  byCategory: {} as UnreadNotificationSummary['byCategory'],
};

export default function DashboardScreen() {
  const { user, logout } = useAuthStore();
  const [unread, setUnread] = useState<UnreadNotificationSummary>(emptyUnread);

  const loadUnread = useCallback(async () => {
    try {
      setUnread(await fetchUnreadSummary());
    } catch {
      // A failed count must not block the dashboard; the badge simply stays put.
    }
  }, []);

  // Refreshes on focus so returning from the inbox shows the corrected count.
  useFocusEffect(
    useCallback(() => {
      void loadUnread();
    }, [loadUnread]),
  );

  useEffect(
    () =>
      onRealtime(RealtimeEvent.UNREAD_COUNT, (payload) =>
        setUnread(payload as UnreadNotificationSummary),
      ),
    [],
  );

  const handleLogout = async () => {
    // Removes this device's push token before the credential is cleared.
    await unregisterCurrentDevice();
    disconnectRealtime();
    await logout();
    router.replace('/');
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={{ fontSize: 20, marginBottom: 20 }}>Welcome, {user?.firstName}!</Text>
      <Text style={{ marginBottom: 20 }}>Role: {user?.role}</Text>
      <Pressable
        style={styles.action}
        accessibilityLabel={
          unread.total ? `Notifications, ${unread.total} unread` : 'Notifications, none unread'
        }
        onPress={() => router.push('/(protected)/notifications')}
      >
        <Text style={styles.actionText}>
          Notifications{unread.total ? ` (${unread.total})` : ''}
        </Text>
      </Pressable>
      {/* Available to every role: a lost phone should not need an administrator. */}
      <Pressable
        style={styles.action}
        accessibilityLabel="Security, where your account is signed in"
        onPress={() => router.push('/(protected)/security')}
      >
        <Text style={styles.actionText}>Security and sign-ins</Text>
      </Pressable>
      {(
        [UserRole.SHOP_OWNER, UserRole.STOREKEEPER, UserRole.ADMIN, UserRole.MANAGER] as UserRole[]
      ).includes(user!.role) && (
        <Pressable style={styles.action} onPress={() => router.push('/(protected)/medicines')}>
          <Text style={styles.actionText}>Browse medicines</Text>
        </Pressable>
      )}
      {([UserRole.STOREKEEPER, UserRole.ADMIN, UserRole.MANAGER] as UserRole[]).includes(
        user!.role,
      ) && (
        <Pressable style={styles.action} onPress={() => router.push('/(protected)/inventory')}>
          <Text style={styles.actionText}>View inventory</Text>
        </Pressable>
      )}
      {user?.role === UserRole.SHOP_OWNER && (
        <>
          <Pressable style={styles.action} onPress={() => router.push('/(protected)/cart')}>
            <Text style={styles.actionText}>Cart</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={() => router.push('/(protected)/orders')}>
            <Text style={styles.actionText}>Orders</Text>
          </Pressable>
        </>
      )}
      {([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN] as UserRole[]).includes(
        user!.role,
      ) && (
        <Pressable style={styles.action} onPress={() => router.push('/(protected)/approvals')}>
          <Text style={styles.actionText}>Approval queue</Text>
        </Pressable>
      )}
      {user?.role === UserRole.STOREKEEPER && (
        <>
          <Pressable style={styles.action} onPress={() => router.push('/(protected)/fulfilment')}>
            <Text style={styles.actionText}>Picking and packing</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={() => router.push('/(protected)/ready')}>
            <Text style={styles.actionText}>Ready for delivery</Text>
          </Pressable>
        </>
      )}
      {user?.role === UserRole.DELIVERY_PERSON && (
        <Pressable style={styles.action} onPress={() => router.push('/(protected)/deliveries')}>
          <Text style={styles.actionText}>Assigned deliveries</Text>
        </Pressable>
      )}
      {([UserRole.MANAGER, UserRole.ADMIN, UserRole.STOREKEEPER] as UserRole[]).includes(
        user!.role,
      ) && (
        <Pressable style={styles.action} onPress={() => router.push('/(protected)/deliveries')}>
          <Text style={styles.actionText}>Delivery operations</Text>
        </Pressable>
      )}
      {/* Every role except an unassigned account touches returns at some point,
          and the list itself opens on the queue that role actually works. */}
      <Pressable style={styles.action} onPress={() => router.push('/(protected)/returns')}>
        <Text style={styles.actionText}>
          {user?.role === UserRole.SHOP_OWNER ? 'My returns' : 'Customer returns'}
        </Text>
      </Pressable>
      {([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPER_ADMIN] as UserRole[]).includes(
        user!.role,
      ) && (
        <Pressable style={styles.action} onPress={() => router.push('/(protected)/analytics')}>
          <Text style={styles.actionText}>Business analytics</Text>
        </Pressable>
      )}
      {(user?.role === UserRole.SUPER_ADMIN || user?.role === UserRole.ADMIN) && (
        <Pressable
          style={styles.action}
          onPress={() => router.push('/(protected)/system-settings')}
        >
          <Text style={styles.actionText}>System settings</Text>
        </Pressable>
      )}
      {getFinanceNavigation(user?.role).map((item) => (
        <Pressable
          key={item.route}
          accessibilityRole="button"
          style={styles.financeAction}
          onPress={() => router.push(item.route)}
        >
          <Text style={styles.financeActionText}>{item.label}</Text>
        </Pressable>
      ))}
      <Button title="Logout" onPress={handleLogout} color="red" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f4f7f5' },
  content: { alignItems: 'center', justifyContent: 'center', padding: 20, flexGrow: 1 },
  action: {
    backgroundColor: '#126b45',
    paddingVertical: 13,
    paddingHorizontal: 24,
    borderRadius: 9,
    marginBottom: 12,
    minWidth: 220,
  },
  actionText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  financeAction: {
    backgroundColor: '#e6eee9',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 9,
    marginBottom: 10,
    minWidth: 220,
  },
  financeActionText: { color: '#173f2e', fontWeight: '700', textAlign: 'center' },
});
