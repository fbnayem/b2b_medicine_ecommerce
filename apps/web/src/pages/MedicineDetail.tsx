import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UserRole } from '@medsupply/shared-types';
import type { Medicine, MedicineBatch } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import './inventory.css';
import { formatFinanceDate, formatMinor } from '../lib/finance';

export function MedicineDetail() {
  const { id } = useParams();
  const user = useAuthStore((state) => state.user);
  const [medicine, setMedicine] = useState<Medicine>();
  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const canSeeStock = user?.role !== UserRole.SHOP_OWNER;
  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/inventory/medicines/${id}`);
      setMedicine(response.data.data);
      if (canSeeStock)
        setBatches(
          (await apiClient.get('/inventory/batches', { params: { medicineId: id } })).data.data,
        );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load medicine');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  if (loading)
    return (
      <main className="inventory-page">
        <section className="state">Loading medicine…</section>
      </main>
    );
  if (error || !medicine)
    return (
      <main className="inventory-page">
        <section className="state error">
          <p>{error || 'Medicine not found'}</p>
          <button onClick={() => void load()}>Retry</button>
        </section>
      </main>
    );
  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">
            {medicine.reference} · {medicine.sku}
          </p>
          <h1>
            {medicine.brandName} {medicine.strength}
          </h1>
          <p>
            {medicine.genericName} · {medicine.dosageForm} · {medicine.packSize}
          </p>
        </div>
        <Link className="secondary-button" to="/medicines">
          Back to catalogue
        </Link>
      </header>
      <section className="detail-grid">
        <article className="panel">
          <h2>Product details</h2>
          <dl>
            <dt>Manufacturer</dt>
            <dd>{medicine.manufacturer}</dd>
            <dt>Category</dt>
            <dd>{medicine.category}</dd>
            <dt>Classification</dt>
            <dd>{medicine.classification}</dd>
            <dt>Cold chain</dt>
            <dd>{medicine.coldChain ? 'Required' : 'No'}</dd>
            <dt>Order limits</dt>
            <dd>
              {medicine.minimumOrderQuantity}–{medicine.maximumOrderQuantity ?? 'No maximum'}{' '}
              {medicine.unit}
            </dd>
            <dt>Selling price</dt>
            <dd>{formatMinor(medicine.defaultSellingPriceMinor)}</dd>
            <dt>Availability</dt>
            <dd>{(medicine.totalAvailable ?? 0) > 0 ? 'Available' : 'Out of stock'}</dd>
          </dl>
          <p>{medicine.description}</p>
        </article>
        {canSeeStock && (
          <article className="panel">
            <div className="panel-heading">
              <h2>Batches</h2>
              <Link to="/inventory">Manage inventory</Link>
            </div>
            {batches.length === 0 ? (
              <p className="muted">No stock has been received.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Batch</th>
                      <th>Expiry</th>
                      <th>Available</th>
                      <th>Reserved</th>
                      <th>Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((batch) => (
                      <tr key={batch._id}>
                        <td>{batch.batchNumber}</td>
                        <td>{formatFinanceDate(batch.expiryDate)}</td>
                        <td>{batch.quantities.available}</td>
                        <td>{batch.quantities.reserved}</td>
                        <td>{batch.warehouseLocation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        )}
      </section>
    </main>
  );
}
