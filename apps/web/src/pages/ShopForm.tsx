import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';

export const ShopForm: React.FC = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    primaryPhone: '',
    alternativePhone: '',
    email: '',
    territory: '',
    drugLicenceNumber: '',
    drugLicenceExpiryDate: '',
    creditLimit: 0,
    paymentTermsDays: 30,
    notes: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = {
        ...form,
        creditLimit: Math.round(Number(form.creditLimit) * 100), // convert to paisa
        paymentTermsDays: Number(form.paymentTermsDays),
        drugLicenceExpiryDate: form.drugLicenceExpiryDate || undefined,
      };
      const res = await apiClient.post('/shops', payload);
      navigate(`/shops/${res.data.data._id}`);
    } catch (e: any) {
      setError(
        e.response?.data?.error?.message ||
          e.response?.data?.error?.details?.map((d: any) => d.message).join(', ') ||
          'Failed to create shop',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button
        onClick={() => navigate('/shops')}
        className="text-blue-600 hover:underline mb-6 inline-block text-sm"
      >
        ← Back to Shops
      </button>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add New Shop</h1>

      {error && (
        <div className="mb-4 p-4 bg-red-100 text-red-700 rounded-lg border border-red-200">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5"
      >
        {[
          { label: 'Shop Name *', name: 'name', type: 'text', required: true },
          {
            label: 'Primary Phone * (+8801xxxxxxxxx)',
            name: 'primaryPhone',
            type: 'text',
            required: true,
          },
          { label: 'Alternative Phone', name: 'alternativePhone', type: 'text' },
          { label: 'Email', name: 'email', type: 'email' },
          { label: 'Territory', name: 'territory', type: 'text' },
          { label: 'Drug Licence Number', name: 'drugLicenceNumber', type: 'text' },
          { label: 'Drug Licence Expiry Date', name: 'drugLicenceExpiryDate', type: 'date' },
          { label: 'Credit Limit (৳)', name: 'creditLimit', type: 'number' },
          { label: 'Payment Terms (Days)', name: 'paymentTermsDays', type: 'number' },
        ].map(({ label, name, type, required }) => (
          <div key={name}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
            <input
              type={type}
              name={name}
              required={required}
              value={(form as any)[name]}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        ))}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
          <textarea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            rows={3}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-all"
        >
          {loading ? 'Creating...' : 'Create Shop'}
        </button>
      </form>
    </div>
  );
};
