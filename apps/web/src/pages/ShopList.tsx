import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { ShopStatus } from '@medsupply/shared-types';
import type { Shop } from '@medsupply/shared-types';

const statusBadgeColor: Record<ShopStatus, string> = {
  [ShopStatus.ACTIVE]: 'bg-green-100 text-green-800',
  [ShopStatus.PENDING]: 'bg-yellow-100 text-yellow-800',
  [ShopStatus.INACTIVE]: 'bg-gray-100 text-gray-700',
  [ShopStatus.SUSPENDED]: 'bg-red-100 text-red-800',
  [ShopStatus.CREDIT_BLOCKED]: 'bg-orange-100 text-orange-800',
  [ShopStatus.LICENCE_EXPIRED]: 'bg-purple-100 text-purple-800',
};

export const ShopList: React.FC = () => {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const fetchShops = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiClient.get(`/shops?${params}`);
      setShops(res.data.data);
    } catch (e: any) {
      setError(e.response?.data?.error?.message || 'Failed to load shops');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShops();
  }, [search, statusFilter]);

  const isLicenceNearExpiry = (expiryDate?: Date) => {
    if (!expiryDate) return false;
    const diff = new Date(expiryDate).getTime() - Date.now();
    return diff > 0 && diff < 90 * 24 * 60 * 60 * 1000;
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Medicine Shops</h1>
        <a
          href="/shops/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
        >
          + Add Shop
        </a>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <input
          type="text"
          placeholder="Search by name, phone or reference..."
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          {Object.values(ShopStatus).map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      {/* Error State */}
      {error && <div className="p-4 mb-4 text-red-700 bg-red-100 rounded-lg">{error}</div>}

      {/* Loading State */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : shops.length === 0 ? (
        /* Empty State */
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg font-medium">No shops found.</p>
          <p className="text-sm mt-1">Try adjusting your search or add a new shop.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {[
                  'Reference',
                  'Name',
                  'Phone',
                  'Territory',
                  'Credit Limit',
                  'Licence Expiry',
                  'Status',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {shops.map((shop) => (
                <tr
                  key={shop._id}
                  className="hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => (window.location.href = `/shops/${shop._id}`)}
                >
                  <td className="px-4 py-3 font-mono text-sm text-blue-600">{shop.reference}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{shop.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{shop.primaryPhone}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{shop.territory || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    ৳{(shop.creditLimit / 100).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {shop.drugLicenceExpiryDate ? (
                      <span
                        className={
                          isLicenceNearExpiry(shop.drugLicenceExpiryDate)
                            ? 'text-orange-600 font-medium'
                            : 'text-gray-600'
                        }
                      >
                        {new Date(shop.drugLicenceExpiryDate).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                        {isLicenceNearExpiry(shop.drugLicenceExpiryDate) && ' ⚠️'}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-semibold ${statusBadgeColor[shop.status]}`}
                    >
                      {shop.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
