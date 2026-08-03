import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { MedicineClassification } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import './inventory.css';

const initial = {
  sku: '',
  barcode: '',
  brandName: '',
  genericName: '',
  manufacturer: '',
  strength: '',
  dosageForm: '',
  packSize: '',
  unit: '',
  category: '',
  description: '',
  costPrice: '',
  sellingPrice: '',
  minimumOrderQuantity: '1',
  maximumOrderQuantity: '',
  classification: MedicineClassification.PRESCRIPTION,
  coldChain: false,
};

export function MedicineForm() {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  function field(name: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [name]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await apiClient.post('/inventory/medicines', {
        ...form,
        barcode: form.barcode || undefined,
        costPriceMinor: Math.round(Number(form.costPrice) * 100),
        defaultSellingPriceMinor: Math.round(Number(form.sellingPrice) * 100),
        minimumOrderQuantity: Number(form.minimumOrderQuantity),
        maximumOrderQuantity: form.maximumOrderQuantity
          ? Number(form.maximumOrderQuantity)
          : undefined,
      });
      navigate(`/medicines/${response.data.data._id}`);
    } catch (caught: unknown) {
      setError(
        (caught as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Unable to save medicine',
      );
    } finally {
      setSaving(false);
    }
  }
  const textFields: Array<[keyof typeof form, string, string]> = [
    ['sku', 'SKU', 'text'],
    ['barcode', 'Barcode', 'text'],
    ['brandName', 'Brand name', 'text'],
    ['genericName', 'Generic name', 'text'],
    ['manufacturer', 'Manufacturer', 'text'],
    ['strength', 'Strength', 'text'],
    ['dosageForm', 'Dosage form', 'text'],
    ['packSize', 'Pack size', 'text'],
    ['unit', 'Unit', 'text'],
    ['category', 'Category', 'text'],
    ['costPrice', 'Cost price (৳)', 'number'],
    ['sellingPrice', 'Selling price (৳)', 'number'],
    ['minimumOrderQuantity', 'Minimum order quantity', 'number'],
    ['maximumOrderQuantity', 'Maximum order quantity', 'number'],
  ];
  return (
    <main className="inventory-page narrow">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Catalogue</p>
          <h1>Add medicine</h1>
          <p>Prices are entered in BDT and stored as integer paisa.</p>
        </div>
      </header>
      <form className="data-form" onSubmit={submit}>
        {error && (
          <div className="state error" role="alert">
            {error}
          </div>
        )}
        <div className="form-grid">
          {textFields.map(([name, label, type]) => (
            <label key={name}>
              {label}
              <input
                required={!['barcode', 'maximumOrderQuantity'].includes(name)}
                type={type}
                min={type === 'number' ? 0 : undefined}
                step={name === 'costPrice' || name === 'sellingPrice' ? '0.01' : undefined}
                value={String(form[name])}
                onChange={(event) => field(name, event.target.value)}
              />
            </label>
          ))}
          <label>
            Classification
            <select
              value={form.classification}
              onChange={(event) => field('classification', event.target.value)}
            >
              {Object.values(MedicineClassification).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.coldChain}
              onChange={(event) => field('coldChain', event.target.checked)}
            />{' '}
            Requires cold chain
          </label>
          <label className="wide">
            Description
            <textarea
              value={form.description}
              onChange={(event) => field('description', event.target.value)}
            />
          </label>
        </div>
        <div className="actions">
          <button className="primary-button" disabled={saving}>
            {saving ? 'Saving…' : 'Save medicine'}
          </button>
          <button className="secondary-button" type="button" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}
