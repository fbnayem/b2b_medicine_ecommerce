import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import './inventory.css';

type ReadyPackage = {
  _id: string;
  reference: string;
  barcode: string;
  packageCount: number;
  orderId: { reference: string };
  invoiceId: { reference: string; grandTotalMinor: number };
};

const money = (minor: number) => `৳${(minor / 100).toFixed(2)}`;

export function ReadyQueue() {
  const [data, setData] = useState<ReadyPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      setData((await apiClient.get('/fulfilment/ready')).data.data);
      setError('');
    } catch {
      setError('Unable to load ready packages.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Storekeeper</p>
          <h1>Ready for delivery</h1>
        </div>
        <Link to="/fulfilment">Queue</Link>
      </header>
      {error ? (
        <section className="state error">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}
      {loading ? (
        <section className="state">Loading ready packages...</section>
      ) : data.length === 0 ? (
        <section className="state">No packages ready.</section>
      ) : (
        <section className="catalogue-grid">
          {data.map((item) => (
            <article className="medicine-card" key={item._id}>
              <span className="reference">{item.reference}</span>
              <h2>{item.orderId.reference}</h2>
              <p>
                {item.invoiceId.reference} / {money(item.invoiceId.grandTotalMinor)}
              </p>
              <p className="barcode-label">{item.barcode}</p>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
