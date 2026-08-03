import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UserRole } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import './inventory.css';
import { formatMinor } from '../lib/finance';

type PickingItem = {
  _id: string;
  medicineId: { _id: string; brandName: string; genericName: string; strength: string };
  batchId: string;
  quantity: number;
  pickedQuantity: number;
  packedQuantity: number;
};
type Discrepancy = {
  _id: string;
  type: string;
  quantity: number;
  notes: string;
  status: string;
  resolutionNotes?: string;
};
type PickingList = {
  _id: string;
  status: string;
  version: number;
  items: PickingItem[];
  orderId: { reference: string; shopId: { name: string } };
  discrepancies: Discrepancy[];
};
type IssuedResult = {
  invoice: {
    _id: string;
    reference: string;
    items: Array<{
      medicineSnapshot: { brandName: string };
      batchNumber: string;
      quantity: number;
      lineTotalMinor: number;
    }>;
    subtotalMinor: number;
    orderDiscountMinor: number;
    deliveryChargeMinor: number;
    taxMinor: number;
    previousBalanceMinor: number;
    grandTotalMinor: number;
    totalOutstandingMinor: number;
  };
  package: { reference: string; barcode: string; packageCount: number; weightGrams?: number };
};
type ApiFailure = { response?: { data?: { error?: { message?: string } } } };

const money = formatMinor;
const discrepancyTypes = [
  'MISSING_QUANTITY',
  'DAMAGED_ITEM',
  'WRONG_BATCH',
  'EXPIRED_BATCH',
  'STOCK_MISMATCH',
  'PRODUCT_UNAVAILABLE',
  'OTHER',
] as const;

export function FulfilmentWork() {
  const { id } = useParams();
  const role = useAuthStore((state) => state.user?.role);
  const isStorekeeper = role === UserRole.STOREKEEPER;
  const resolverRoles: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
  const canResolve = role ? resolverRoles.includes(role) : false;
  const [list, setList] = useState<PickingList>();
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [packed, setPacked] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [packageCount, setPackageCount] = useState(1);
  const [weight, setWeight] = useState(0);
  const [notes, setNotes] = useState('');
  const [discrepancyType, setDiscrepancyType] =
    useState<(typeof discrepancyTypes)[number]>('MISSING_QUANTITY');
  const [discrepancyQuantity, setDiscrepancyQuantity] = useState(0);
  const [discrepancyNotes, setDiscrepancyNotes] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [issued, setIssued] = useState<IssuedResult>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const value: PickingList = (await apiClient.get(`/fulfilment/picking/${id}`)).data.data;
      setList(value);
      setPicked(
        Object.fromEntries(
          value.items.map((item) => [item._id, item.pickedQuantity || item.quantity]),
        ),
      );
      setPacked(
        Object.fromEntries(
          value.items.map((item) => [item._id, item.pickedQuantity || item.quantity]),
        ),
      );
      setError('');
    } catch {
      setError('Unable to load picking list.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function failureMessage(caught: unknown, fallback: string) {
    return (caught as ApiFailure).response?.data?.error?.message ?? fallback;
  }

  async function start() {
    if (!list) return;
    try {
      await apiClient.post(`/fulfilment/picking/${id}/start`, { version: list.version });
      setSuccess('Picking started. Confirm each allocated batch and quantity.');
      await load();
    } catch (caught: unknown) {
      setError(failureMessage(caught, 'Unable to start picking.'));
    }
  }

  async function saveProgress(action: 'SAVE' | 'PAUSE' | 'COMPLETE') {
    if (!list) return;
    try {
      await apiClient.post(`/fulfilment/picking/${id}/progress`, {
        version: list.version,
        action,
        items: list.items.map((item) => ({
          medicineId: item.medicineId._id,
          batchId: item.batchId,
          pickedQuantity: picked[item._id] ?? 0,
        })),
      });
      setSuccess(
        action === 'COMPLETE'
          ? 'Picking completed and moved to packing.'
          : action === 'PAUSE'
            ? 'Picking paused.'
            : 'Picking progress saved.',
      );
      await load();
    } catch (caught: unknown) {
      setError(failureMessage(caught, 'Unable to update picking.'));
    }
  }

  async function resume() {
    if (!list) return;
    try {
      await apiClient.post(`/fulfilment/picking/${id}/resume`, { version: list.version });
      setSuccess('Picking resumed.');
      await load();
    } catch (caught: unknown) {
      setError(failureMessage(caught, 'Unable to resume picking.'));
    }
  }

  async function reportDiscrepancy() {
    if (!list?.items[0] || discrepancyNotes.trim().length < 3) {
      setError('Enter at least three characters describing the discrepancy.');
      return;
    }
    try {
      await apiClient.post(`/fulfilment/picking/${id}/discrepancies`, {
        version: list.version,
        type: discrepancyType,
        medicineId: list.items[0].medicineId._id,
        batchId: list.items[0].batchId,
        quantity: discrepancyQuantity,
        notes: discrepancyNotes,
      });
      setSuccess('Discrepancy reported to management.');
      await load();
    } catch (caught: unknown) {
      setError(failureMessage(caught, 'Unable to report discrepancy.'));
    }
  }

  async function resolveDiscrepancy() {
    const resolutionNotes = window.prompt('Enter resolution notes:');
    if (!resolutionNotes || !list) return;
    try {
      await apiClient.post(`/fulfilment/picking/${id}/discrepancies/resolve`, {
        version: list.version,
        resolutionNotes,
      });
      setSuccess('Discrepancy resolved and returned to picking.');
      await load();
    } catch (caught: unknown) {
      setError(failureMessage(caught, 'Unable to resolve discrepancy.'));
    }
  }

  async function pack() {
    if (!list) return;
    try {
      const response = await apiClient.post(`/fulfilment/picking/${id}/pack`, {
        version: list.version,
        items: list.items.map((item) => ({
          medicineId: item.medicineId._id,
          batchId: item.batchId,
          packedQuantity: packed[item._id] ?? 0,
          shortfallReason:
            (packed[item._id] ?? 0) < item.pickedQuantity ? reasons[item._id] : undefined,
        })),
        packageCount,
        weightGrams: weight || undefined,
        notes: notes || undefined,
      });
      setIssued(response.data.data);
      setSuccess('Package and immutable invoice created from packed quantities.');
      setError('');
    } catch (caught: unknown) {
      setError(failureMessage(caught, 'Packing failed.'));
    }
  }

  async function download(layout: 'a4' | 'thermal') {
    if (!issued) return;
    try {
      const response = await apiClient.get(`/fulfilment/invoices/${issued.invoice._id}/pdf`, {
        params: { layout },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError('Unable to download the invoice PDF.');
    }
  }

  function print(layout: 'a4' | 'thermal') {
    document.body.dataset.invoiceLayout = layout;
    window.print();
    window.setTimeout(() => delete document.body.dataset.invoiceLayout, 500);
  }

  if (loading)
    return (
      <main className="inventory-page">
        <section className="state">Loading picking list...</section>
      </main>
    );
  if (!list)
    return (
      <main className="inventory-page">
        <section className="state error">
          {error || 'Picking list not found.'}
          <button onClick={() => void load()}>Retry</button>
        </section>
      </main>
    );

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{list.status.replaceAll('_', ' ')}</p>
          <h1>{list.orderId.reference}</h1>
          <p>{list.orderId.shopId.name}</p>
        </div>
        <Link className="secondary-button" to="/fulfilment">
          Queue
        </Link>
      </header>
      {error ? <section className="state error">{error}</section> : null}
      {success ? <section className="state success">{success}</section> : null}
      {list.discrepancies.length > 0 ? (
        <section className="panel">
          <h2>Discrepancies</h2>
          <ul className="movement-list">
            {list.discrepancies.map((item) => (
              <li key={item._id}>
                <div>
                  <strong>{item.type.replaceAll('_', ' ')}</strong>
                  <span>{item.notes}</span>
                </div>
                <div>
                  <span>{item.status}</span>
                  <small>{item.resolutionNotes}</small>
                </div>
              </li>
            ))}
          </ul>
          {list.status === 'BLOCKED_DISCREPANCY' && canResolve ? (
            <button className="primary-button" onClick={() => void resolveDiscrepancy()}>
              Resolve and return to picking
            </button>
          ) : null}
        </section>
      ) : null}
      {isStorekeeper && ['PICKING', 'PAUSED', 'PACKING'].includes(list.status) ? (
        <section className="panel data-form">
          <h2>Report discrepancy</h2>
          <div className="form-grid">
            <label>
              Type
              <select
                value={discrepancyType}
                onChange={(event) =>
                  setDiscrepancyType(event.target.value as (typeof discrepancyTypes)[number])
                }
              >
                {discrepancyTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Affected quantity
              <input
                type="number"
                min="0"
                value={discrepancyQuantity}
                onChange={(event) => setDiscrepancyQuantity(Number(event.target.value))}
              />
            </label>
            <label className="wide">
              Notes
              <textarea
                value={discrepancyNotes}
                onChange={(event) => setDiscrepancyNotes(event.target.value)}
              />
            </label>
          </div>
          <button className="secondary-button" onClick={() => void reportDiscrepancy()}>
            Report to management
          </button>
        </section>
      ) : null}
      {issued ? (
        <section className="detail-grid">
          <article className="panel invoice-print">
            <h2>{issued.invoice.reference}</h2>
            {issued.invoice.items.map((item, index) => (
              <p key={index}>
                {item.medicineSnapshot.brandName} / {item.batchNumber} / {item.quantity} /{' '}
                {money(item.lineTotalMinor)}
              </p>
            ))}
            <dl>
              <dt>Subtotal</dt>
              <dd>{money(issued.invoice.subtotalMinor)}</dd>
              <dt>Order discount</dt>
              <dd>{money(issued.invoice.orderDiscountMinor)}</dd>
              <dt>Delivery</dt>
              <dd>{money(issued.invoice.deliveryChargeMinor)}</dd>
              <dt>Tax</dt>
              <dd>{money(issued.invoice.taxMinor)}</dd>
              <dt>Grand total</dt>
              <dd>{money(issued.invoice.grandTotalMinor)}</dd>
              <dt>Previous balance</dt>
              <dd>{money(issued.invoice.previousBalanceMinor)}</dd>
              <dt>Total outstanding</dt>
              <dd>{money(issued.invoice.totalOutstandingMinor)}</dd>
            </dl>
            <p className="signature-line">Authorised signature: ____________________</p>
            <div className="actions no-print">
              <button className="primary-button" onClick={() => void download('a4')}>
                A4 PDF
              </button>
              <button className="secondary-button" onClick={() => void download('thermal')}>
                Thermal PDF
              </button>
              <button className="secondary-button" onClick={() => print('a4')}>
                Print A4
              </button>
              <button className="secondary-button" onClick={() => print('thermal')}>
                Print thermal
              </button>
            </div>
          </article>
          <article className="panel package-label">
            <h2>Package label</h2>
            <p className="reference">{issued.package.reference}</p>
            <p className="barcode-label">{issued.package.barcode}</p>
            <p>{issued.package.packageCount} package(s)</p>
            {issued.package.weightGrams ? <p>{issued.package.weightGrams} g</p> : null}
          </article>
        </section>
      ) : (
        <>
          <section className="panel">
            <h2>{list.status === 'PACKING' ? 'Packing confirmation' : 'Allocated FEFO batches'}</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Batch</th>
                    <th>Allocated</th>
                    <th>Picked</th>
                    <th>Packed</th>
                    <th>Shortfall reason</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((item) => (
                    <tr key={item._id}>
                      <td>
                        {item.medicineId.brandName} {item.medicineId.strength}
                      </td>
                      <td>{item.batchId}</td>
                      <td>{item.quantity}</td>
                      <td>
                        {list.status === 'PICKING' ? (
                          <input
                            aria-label={`Picked quantity for ${item.medicineId.brandName}`}
                            type="number"
                            min="0"
                            max={item.quantity}
                            value={picked[item._id] ?? 0}
                            onChange={(event) =>
                              setPicked((current) => ({
                                ...current,
                                [item._id]: Number(event.target.value),
                              }))
                            }
                          />
                        ) : (
                          item.pickedQuantity
                        )}
                      </td>
                      <td>
                        {list.status === 'PACKING' ? (
                          <input
                            aria-label={`Packed quantity for ${item.medicineId.brandName}`}
                            type="number"
                            min="0"
                            max={item.pickedQuantity}
                            value={packed[item._id] ?? 0}
                            onChange={(event) =>
                              setPacked((current) => ({
                                ...current,
                                [item._id]: Number(event.target.value),
                              }))
                            }
                          />
                        ) : (
                          item.packedQuantity
                        )}
                      </td>
                      <td>
                        {list.status === 'PACKING' ? (
                          <input
                            aria-label={`Shortfall reason for ${item.medicineId.brandName}`}
                            value={reasons[item._id] ?? ''}
                            onChange={(event) =>
                              setReasons((current) => ({
                                ...current,
                                [item._id]: event.target.value,
                              }))
                            }
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {list.status === 'PACKING' && isStorekeeper ? (
            <section className="panel data-form">
              <div className="form-grid">
                <label>
                  Package count
                  <input
                    type="number"
                    min="1"
                    value={packageCount}
                    onChange={(event) => setPackageCount(Number(event.target.value))}
                  />
                </label>
                <label>
                  Weight (grams, optional)
                  <input
                    type="number"
                    min="0"
                    value={weight}
                    onChange={(event) => setWeight(Number(event.target.value))}
                  />
                </label>
                <label className="wide">
                  Packing notes
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
                </label>
              </div>
              <button className="primary-button" onClick={() => void pack()}>
                Confirm packing and issue invoice
              </button>
            </section>
          ) : null}
          {isStorekeeper ? (
            <section className="panel actions">
              {list.status === 'PENDING' ? (
                <button className="primary-button" onClick={() => void start()}>
                  Start picking
                </button>
              ) : null}
              {list.status === 'PICKING' ? (
                <>
                  <button className="secondary-button" onClick={() => void saveProgress('SAVE')}>
                    Save progress
                  </button>
                  <button className="secondary-button" onClick={() => void saveProgress('PAUSE')}>
                    Pause
                  </button>
                  <button className="primary-button" onClick={() => void saveProgress('COMPLETE')}>
                    Complete picking
                  </button>
                </>
              ) : null}
              {list.status === 'PAUSED' ? (
                <button className="primary-button" onClick={() => void resume()}>
                  Resume picking
                </button>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
