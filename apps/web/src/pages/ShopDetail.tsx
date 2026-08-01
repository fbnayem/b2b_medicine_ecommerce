import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { ShopStatus } from '@medsupply/shared-types';
import type { Shop } from '@medsupply/shared-types';
import './inventory.css';

export const ShopDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    apiClient
      .get(`/shops/${id}`)
      .then((r) => setShop(r.data.data))
      .catch((e) => setError(e.response?.data?.error?.message || 'Failed to load shop'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleStatusChange = async (status: ShopStatus, reason?: string) => {
    try {
      const res = await apiClient.patch(`/shops/${id}/status`, { status, reason });
      setShop(res.data.data);
      setStatusMessage(`Status updated to ${status}`);
    } catch (e: any) {
      setError(e.response?.data?.error?.message || 'Failed to update status');
    }
  };

  if (loading)
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!shop) return <div className="p-8 text-gray-500">Shop not found.</div>;

  const licenceExpirySoon =
    shop.drugLicenceExpiryDate &&
    new Date(shop.drugLicenceExpiryDate).getTime() - Date.now() < 90 * 24 * 60 * 60 * 1000;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button
        onClick={() => navigate('/shops')}
        className="text-blue-600 hover:underline mb-6 inline-block text-sm"
      >
        ← Back to Shops
      </button>
      <div className="actions finance-shop-actions">
        <Link className="secondary-button" to={`/shops/${id}/ledger`}>
          Customer ledger
        </Link>
        <Link className="secondary-button" to={`/shops/${id}/statement`}>
          Statement
        </Link>
        <Link className="primary-button" to={`/payments/new?shopId=${id}`}>
          Record payment
        </Link>
      </div>

      {statusMessage && (
        <div className="mb-4 p-3 bg-green-100 text-green-700 rounded-lg border border-green-200">
          {statusMessage}
        </div>
      )}
      {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">{error}</div>}

      {/* Licence Warning */}
      {licenceExpirySoon && (
        <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-lg text-orange-700">
          ⚠️ Drug licence expires on{' '}
          {new Date(shop.drugLicenceExpiryDate!).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{shop.name}</h1>
            <p className="text-sm text-blue-600 font-mono mt-1">{shop.reference}</p>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-sm font-semibold ${
              shop.status === ShopStatus.ACTIVE
                ? 'bg-green-100 text-green-800'
                : shop.status === ShopStatus.SUSPENDED
                  ? 'bg-red-100 text-red-800'
                  : 'bg-gray-100 text-gray-700'
            }`}
          >
            {shop.status.replace('_', ' ')}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
              Primary Phone
            </p>
            <p className="text-gray-900">{shop.primaryPhone}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Email</p>
            <p className="text-gray-900">{shop.email || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
              Credit Limit
            </p>
            <p className="text-gray-900 font-semibold">
              ৳{(shop.creditLimit / 100).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
              Outstanding Balance
            </p>
            <p className="text-gray-900 font-semibold">
              ৳{(shop.outstandingBalance / 100).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
              Drug Licence
            </p>
            <p className="text-gray-900">{shop.drugLicenceNumber || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">
              Payment Terms
            </p>
            <p className="text-gray-900">{shop.paymentTermsDays} days</p>
          </div>
        </div>

        {/* Delivery Addresses */}
        {shop.deliveryAddresses && shop.deliveryAddresses.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Delivery Addresses</h3>
            <div className="space-y-2">
              {shop.deliveryAddresses.map((addr: any, i: number) => (
                <div key={i} className="p-3 bg-gray-50 rounded-lg text-sm text-gray-700">
                  <span className="font-medium">{addr.label}</span>: {addr.line1}, {addr.city},{' '}
                  {addr.district}
                  {addr.isDefault && (
                    <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                      Default
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status Controls */}
        <div className="border-t pt-4 mt-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Status Management</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleStatusChange(ShopStatus.ACTIVE)}
              className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
            >
              Activate
            </button>
            <button
              onClick={() => handleStatusChange(ShopStatus.SUSPENDED, 'Suspended by admin')}
              className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors"
            >
              Suspend
            </button>
            <button
              onClick={() => handleStatusChange(ShopStatus.CREDIT_BLOCKED, 'Credit limit exceeded')}
              className="px-3 py-1.5 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700 transition-colors"
            >
              Block Credit
            </button>
            <button
              onClick={() => handleStatusChange(ShopStatus.INACTIVE)}
              className="px-3 py-1.5 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 transition-colors"
            >
              Deactivate
            </button>
          </div>
        </div>

        {shop.notes && (
          <div className="border-t pt-4 mt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">Internal Notes</h3>
            <p className="text-sm text-gray-600">{shop.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
};
