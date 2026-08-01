import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { UserRole } from '@medsupply/shared-types';
import type { Medicine } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { useCart } from '../store/useCart';
import './inventory.css';

const money = (minor: number) =>
  `৳${(minor / 100).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`;

export function MedicineList() {
  const user = useAuthStore((state) => state.user);
  const addToCart = useCart((state) => state.add);
  const [items, setItems] = useState<Medicine[]>([]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canManage =
    user &&
    ([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER] as UserRole[]).includes(user.role);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setItems(
        (await apiClient.get('/inventory/medicines', { params: { search: query, limit: 100 } }))
          .data.data,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load medicines');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [query]);
  function submit(event: FormEvent) {
    event.preventDefault();
    setQuery(search.trim());
  }

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Catalogue</p>
          <h1>Medicines</h1>
          <p>Browse current medicines and general stock availability.</p>
        </div>
        <div className="actions">
          {canManage && (
            <Link className="primary-button" to="/medicines/new">
              Add medicine
            </Link>
          )}{' '}
          {user?.role !== UserRole.SHOP_OWNER && (
            <Link className="secondary-button" to="/inventory">
              Inventory
            </Link>
          )}
        </div>
      </header>
      <form className="search-bar" onSubmit={submit}>
        <label htmlFor="medicine-search">Search catalogue</label>
        <div>
          <input
            id="medicine-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Brand, generic, manufacturer, SKU or barcode"
          />
          <button>Search</button>
        </div>
      </form>
      {error && (
        <section className="state error" role="alert">
          <p>{error}</p>
          <button onClick={() => void load()}>Retry</button>
        </section>
      )}
      {loading ? (
        <section className="state">Loading medicines…</section>
      ) : !error && items.length === 0 ? (
        <section className="state">
          <h2>No medicines found</h2>
          <p>Try a broader search.</p>
        </section>
      ) : (
        <section className="catalogue-grid">
          {items.map((medicine) => (
            <Link className="medicine-card" to={`/medicines/${medicine._id}`} key={medicine._id}>
              <div className="card-top">
                <span className="reference">{medicine.reference}</span>
                <span className={medicine.isActive ? 'status active' : 'status'}>
                  {medicine.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <h2>
                {medicine.brandName} {medicine.strength}
              </h2>
              <p>
                {medicine.genericName} · {medicine.dosageForm}
              </p>
              <p className="muted">
                {medicine.manufacturer} · {medicine.packSize}
              </p>
              <div className="card-bottom">
                <strong>{money(medicine.defaultSellingPriceMinor)}</strong>
                <span>{(medicine.totalAvailable ?? 0) > 0 ? 'Available' : 'Out of stock'}</span>
              </div>
              {user?.role === UserRole.SHOP_OWNER && (
                <button
                  className="primary-button"
                  disabled={(medicine.totalAvailable ?? 0) === 0}
                  onClick={(event) => {
                    event.preventDefault();
                    addToCart(medicine);
                  }}
                >
                  Add to cart
                </button>
              )}
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
