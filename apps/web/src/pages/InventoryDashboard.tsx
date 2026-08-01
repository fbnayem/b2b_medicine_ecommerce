import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { StockMovementType } from '@medsupply/shared-types';
import type { Medicine, MedicineBatch } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import './inventory.css';

type Movement = {
  _id: string;
  type: StockMovementType;
  quantity: number;
  reason: string;
  createdAt: string;
  medicineId?: { brandName: string; sku: string };
  batchId?: { batchNumber: string };
};
const freshKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function InventoryDashboard() {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [receipt, setReceipt] = useState({
    medicineId: '',
    batchNumber: '',
    manufacturingDate: '',
    expiryDate: '',
    costPrice: '',
    sellingPrice: '',
    quantity: '',
    warehouseLocation: '',
    notes: '',
  });
  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = warning ? { warning } : {};
      const [medicineResponse, batchResponse, movementResponse] = await Promise.all([
        apiClient.get('/inventory/medicines', { params: { limit: 100 } }),
        apiClient.get('/inventory/batches', { params }),
        apiClient.get('/inventory/movements', { params: { limit: 50 } }),
      ]);
      setMedicines(medicineResponse.data.data);
      setBatches(batchResponse.data.data);
      setMovements(movementResponse.data.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load inventory');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [warning]);
  async function receive(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSuccess('');
    try {
      await apiClient.post('/inventory/batches/receive', {
        ...receipt,
        costPriceMinor: Math.round(Number(receipt.costPrice) * 100),
        sellingPriceOverrideMinor: receipt.sellingPrice
          ? Math.round(Number(receipt.sellingPrice) * 100)
          : undefined,
        quantity: Number(receipt.quantity),
      });
      setSuccess('Stock received successfully.');
      setReceipt({
        medicineId: '',
        batchNumber: '',
        manufacturingDate: '',
        expiryDate: '',
        costPrice: '',
        sellingPrice: '',
        quantity: '',
        warehouseLocation: '',
        notes: '',
      });
      await load();
    } catch (caught: unknown) {
      setError(
        (caught as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Stock receipt failed',
      );
    }
  }
  async function action(batch: MedicineBatch, type: StockMovementType) {
    const raw = window.prompt(`Quantity to ${type.toLowerCase().replaceAll('_', ' ')}:`);
    if (!raw) return;
    const reason = window.prompt('Reason for this stock operation:');
    if (!reason) return;
    try {
      await apiClient.post(`/inventory/batches/${batch._id}/operations`, {
        type,
        quantity: Number(raw),
        reason,
        idempotencyKey: freshKey(),
      });
      setSuccess(`${type.replaceAll('_', ' ')} recorded.`);
      await load();
    } catch (caught: unknown) {
      setError(
        (caught as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error
          ?.message ?? 'Operation failed',
      );
    }
  }
  const totals = batches.reduce(
    (sum, b) => ({
      onHand: sum.onHand + b.quantities.onHand,
      available: sum.available + b.quantities.available,
      reserved: sum.reserved + b.quantities.reserved,
      damaged: sum.damaged + b.quantities.damaged,
    }),
    { onHand: 0, available: 0, reserved: 0, damaged: 0 },
  );
  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Inventory dashboard</h1>
          <p>Batch stock, warnings and immutable movement history.</p>
        </div>
      </header>
      {error && (
        <section className="state error" role="alert">
          <p>{error}</p>
          <button onClick={() => void load()}>Retry</button>
        </section>
      )}
      {success && (
        <section className="state success" role="status">
          {success}
        </section>
      )}
      <section className="metric-grid">
        {Object.entries(totals).map(([key, value]) => (
          <article key={key}>
            <span>{key}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <nav className="filter-tabs" aria-label="Stock warning filter">
        {[
          ['', 'All batches'],
          ['low-stock', 'Low stock'],
          ['near-expiry', 'Near expiry'],
          ['expired', 'Expired'],
        ].map(([value, label]) => (
          <button
            className={warning === value ? 'selected' : ''}
            key={value}
            onClick={() => setWarning(value)}
          >
            {label}
          </button>
        ))}
      </nav>
      {loading ? (
        <section className="state">Loading inventory…</section>
      ) : (
        <section className="panel">
          <h2>Batch stock</h2>
          {batches.length === 0 ? (
            <div className="state">No batches match this view.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Medicine / batch</th>
                    <th>Expiry</th>
                    <th>On hand</th>
                    <th>Available</th>
                    <th>Reserved</th>
                    <th>Picking</th>
                    <th>Packed</th>
                    <th>Warnings</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => {
                    const medicine = batch.medicineId as Medicine;
                    return (
                      <tr key={batch._id}>
                        <td>
                          <strong>{medicine.brandName}</strong>
                          <small>
                            {batch.batchNumber} · {batch.warehouseLocation}
                          </small>
                        </td>
                        <td>
                          {new Date(batch.expiryDate).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td>{batch.quantities.onHand}</td>
                        <td>{batch.quantities.available}</td>
                        <td>{batch.quantities.reserved}</td>
                        <td>{batch.quantities.picking}</td>
                        <td>{batch.quantities.packed}</td>
                        <td>
                          {batch.isBlocked ? 'Blocked ' : ''}
                          {batch.isQuarantined ? 'Quarantined' : ''}
                        </td>
                        <td>
                          <select
                            aria-label={`Action for ${batch.batchNumber}`}
                            defaultValue=""
                            onChange={(event) => {
                              const value = event.target.value as StockMovementType;
                              if (value) void action(batch, value);
                              event.target.value = '';
                            }}
                          >
                            <option value="">Choose…</option>
                            <option value={StockMovementType.DAMAGE}>Record damage</option>
                            <option value={StockMovementType.EXPIRY}>Record expiry</option>
                            <option value={StockMovementType.QUARANTINE}>Quarantine</option>
                            <option value={StockMovementType.QUARANTINE_RELEASE}>
                              Release quarantine
                            </option>
                            <option value={StockMovementType.RESERVATION}>Reserve</option>
                            <option value={StockMovementType.RESERVATION_RELEASE}>
                              Release reservation
                            </option>
                            <option value={StockMovementType.PICKING}>Move to picking</option>
                            <option value={StockMovementType.PICKING_RETURN}>
                              Return from picking
                            </option>
                            <option value={StockMovementType.PACKING}>Move to packed</option>
                            <option value={StockMovementType.PACKING_REVERSAL}>
                              Reverse packed
                            </option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <section className="detail-grid">
        <form className="panel data-form" onSubmit={receive}>
          <h2>Receive stock</h2>
          {[
            ['batchNumber', 'Batch number', 'text'],
            ['manufacturingDate', 'Manufacturing date', 'date'],
            ['expiryDate', 'Expiry date', 'date'],
            ['costPrice', 'Cost price (৳)', 'number'],
            ['sellingPrice', 'Selling override (৳)', 'number'],
            ['quantity', 'Received quantity', 'number'],
            ['warehouseLocation', 'Warehouse location', 'text'],
          ].map(([name, label, type]) => (
            <label key={name}>
              {label}
              <input
                required={name !== 'sellingPrice'}
                type={type}
                min={type === 'number' ? 0 : undefined}
                value={receipt[name as keyof typeof receipt]}
                onChange={(event) =>
                  setReceipt((current) => ({ ...current, [name]: event.target.value }))
                }
              />
            </label>
          ))}
          <label>
            Medicine
            <select
              required
              value={receipt.medicineId}
              onChange={(event) =>
                setReceipt((current) => ({ ...current, medicineId: event.target.value }))
              }
            >
              <option value="">Select medicine</option>
              {medicines.map((m) => (
                <option key={m._id} value={m._id}>
                  {m.brandName} · {m.sku}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notes
            <textarea
              value={receipt.notes}
              onChange={(event) =>
                setReceipt((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </label>
          <button className="primary-button">Receive stock</button>
        </form>
        <section className="panel">
          <h2>Recent stock movements</h2>
          {movements.length === 0 ? (
            <p className="muted">No movements recorded.</p>
          ) : (
            <ol className="movement-list">
              {movements.map((m) => (
                <li key={m._id}>
                  <div>
                    <strong>{m.type.replaceAll('_', ' ')}</strong>
                    <span>
                      {m.medicineId?.brandName} · {m.batchId?.batchNumber}
                    </span>
                    <small>{m.reason}</small>
                  </div>
                  <div>
                    <strong>{m.quantity}</strong>
                    <small>{new Date(m.createdAt).toLocaleString('en-BD')}</small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </section>
    </main>
  );
}
