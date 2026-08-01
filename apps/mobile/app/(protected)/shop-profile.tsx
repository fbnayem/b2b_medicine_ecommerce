import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { apiClient } from '../../src/api/client';
import { Shop, ShopStatus } from '@medsupply/shared-types';

export default function ShopProfileScreen() {
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const fetchShop = async () => {
    try {
      const res = await apiClient.get('/shops');
      setShop(res.data.data?.[0] || null);
      setError('');
    } catch (e: any) {
      setError(e.response?.data?.error?.message || 'Failed to load shop details');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchShop();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchShop();
  };

  const isLicenceNearExpiry = (date?: Date) => {
    if (!date) return false;
    const diff = new Date(date).getTime() - Date.now();
    return diff > 0 && diff < 90 * 24 * 60 * 60 * 1000;
  };

  const statusColor: Record<string, string> = {
    ACTIVE: '#16a34a',
    PENDING: '#d97706',
    SUSPENDED: '#dc2626',
    CREDIT_BLOCKED: '#ea580c',
    LICENCE_EXPIRED: '#9333ea',
    INACTIVE: '#6b7280',
  };

  if (loading)
    return (
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Loading shop details…</Text>
      </View>
    );

  if (error)
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={fetchShop}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );

  if (!shop)
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No shop associated with your account.</Text>
        <Text style={styles.emptySubtext}>Please contact your administrator.</Text>
      </View>
    );

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Licence Warning */}
      {isLicenceNearExpiry(shop.drugLicenceExpiryDate) && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            ⚠️ Drug licence expires on{' '}
            {new Date(shop.drugLicenceExpiryDate!).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.shopName}>{shop.name}</Text>
        <Text style={styles.reference}>{shop.reference}</Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor[shop.status] + '20' }]}>
          <Text style={[styles.statusText, { color: statusColor[shop.status] }]}>
            {shop.status.replace('_', ' ')}
          </Text>
        </View>
      </View>

      {/* Credit Summary */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account Summary</Text>
        <View style={styles.row}>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Credit Limit</Text>
            <Text style={styles.metricValue}>৳{(shop.creditLimit / 100).toLocaleString()}</Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Outstanding</Text>
            <Text
              style={[
                styles.metricValue,
                { color: shop.outstandingBalance > 0 ? '#dc2626' : '#16a34a' },
              ]}
            >
              ৳{(shop.outstandingBalance / 100).toLocaleString()}
            </Text>
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Available Credit</Text>
            <Text style={styles.metricValue}>
              ৳{Math.max(0, (shop.creditLimit - shop.outstandingBalance) / 100).toLocaleString()}
            </Text>
          </View>
          <View style={styles.metricBox}>
            <Text style={styles.metricLabel}>Payment Terms</Text>
            <Text style={styles.metricValue}>{shop.paymentTermsDays} days</Text>
          </View>
        </View>
      </View>

      {/* Contact Info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Contact</Text>
        <Text style={styles.infoLabel}>Primary Phone</Text>
        <Text style={styles.infoValue}>{shop.primaryPhone}</Text>
        {shop.email && (
          <>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{shop.email}</Text>
          </>
        )}
      </View>

      {/* Delivery Addresses */}
      {shop.deliveryAddresses?.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Delivery Addresses</Text>
          {shop.deliveryAddresses.map((addr: any, i: number) => (
            <View key={i} style={styles.addressBox}>
              <Text style={styles.addressLabel}>
                {addr.label}
                {addr.isDefault ? ' (Default)' : ''}
              </Text>
              <Text style={styles.addressText}>
                {addr.line1}, {addr.city}, {addr.district}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { color: '#6b7280', fontSize: 16 },
  errorText: { color: '#dc2626', marginBottom: 16, textAlign: 'center' },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#374151', textAlign: 'center' },
  emptySubtext: { fontSize: 13, color: '#6b7280', marginTop: 8, textAlign: 'center' },
  warningBanner: {
    backgroundColor: '#fff7ed',
    borderBottomWidth: 1,
    borderBottomColor: '#fed7aa',
    padding: 12,
  },
  warningText: { color: '#c2410c', fontSize: 13, textAlign: 'center', fontWeight: '500' },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  shopName: { fontSize: 22, fontWeight: '700', color: '#111827' },
  reference: { fontSize: 12, color: '#3b82f6', fontFamily: 'monospace', marginTop: 2 },
  statusBadge: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusText: { fontSize: 12, fontWeight: '600' },
  card: {
    backgroundColor: '#fff',
    margin: 12,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  metricBox: { flex: 1, backgroundColor: '#f9fafb', padding: 12, borderRadius: 8 },
  metricLabel: { fontSize: 11, color: '#6b7280', fontWeight: '500', marginBottom: 4 },
  metricValue: { fontSize: 18, fontWeight: '700', color: '#111827' },
  infoLabel: { fontSize: 11, color: '#6b7280', fontWeight: '500', marginTop: 8 },
  infoValue: { fontSize: 15, color: '#111827', marginTop: 2 },
  addressBox: {
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  addressLabel: { fontSize: 13, fontWeight: '600', color: '#374151' },
  addressText: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  retryBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: { color: '#fff', fontWeight: '600' },
});
