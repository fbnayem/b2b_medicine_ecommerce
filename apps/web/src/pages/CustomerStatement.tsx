import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import { formatFinanceDate, formatMinor } from '../lib/finance';
import type { CustomerStatementData } from './financeTypes';
import './inventory.css';

interface CustomerStatementProps {
  ownerMode?: boolean;
}

function initialDates() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${day}` };
}

export function CustomerStatement({ ownerMode = false }: CustomerStatementProps) {
  const { shopId } = useParams();
  const initial = initialDates();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [applied, setApplied] = useState(initial);
  const [statement, setStatement] = useState<CustomerStatementData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const path = ownerMode ? '/finance/my/statement' : `/finance/shops/${shopId}/statement`;
    setLoading(true);
    try {
      setStatement(
        (await apiClient.get(path, { params: applied })).data.data as CustomerStatementData,
      );
      setError('');
    } catch {
      setError('Unable to prepare this customer statement.');
    } finally {
      setLoading(false);
    }
  }, [applied, ownerMode, shopId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="inventory-page">
      <header className="page-heading no-print">
        <div>
          <p className="eyebrow">Account statement</p>
          <h1>{statement?.shop?.name ?? 'Customer statement'}</h1>
          <p>Opening balance through closing balance for the selected period.</p>
        </div>
        <div className="actions">
          <Link
            className="secondary-button"
            to={ownerMode ? '/account' : `/shops/${shopId}/ledger`}
          >
            Back
          </Link>
          <button className="primary-button" onClick={() => window.print()}>
            Print / save PDF
          </button>
        </div>
      </header>
      <form
        className="panel data-form finance-filters no-print"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ from, to });
        }}
      >
        <div className="form-grid">
          <label>
            From
            <input
              required
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              required
              type="date"
              min={from}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </div>
        <button className="secondary-button">Generate statement</button>
      </form>
      {error ? (
        <section className="state error no-print" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </section>
      ) : null}
      {loading ? (
        <section className="state">Preparing statement...</section>
      ) : statement ? (
        <section className="panel statement-print">
          <div className="statement-heading">
            <div>
              <p className="eyebrow">MedSupply B2B</p>
              <h2>Customer statement</h2>
              <p>
                {statement.shop?.reference} · {statement.shop?.name}
              </p>
            </div>
            <p>
              {formatFinanceDate(statement.from)} – {formatFinanceDate(statement.to)}
            </p>
          </div>
          <div className="statement-balances">
            <span>
              Opening balance <strong>{formatMinor(statement.openingBalanceMinor)}</strong>
            </span>
            <span>
              Closing balance <strong>{formatMinor(statement.closingBalanceMinor)}</strong>
            </span>
          </div>
          {statement.entries.length === 0 ? (
            <div className="state">No account activity in this period.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reference</th>
                    <th>Description</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.entries.map((entry) => (
                    <tr key={entry._id}>
                      <td>
                        {formatFinanceDate(entry.postingTime ?? entry.postedAt ?? entry.createdAt)}
                      </td>
                      <td>{entry.reference ?? entry.sourceReference ?? '—'}</td>
                      <td>{entry.description ?? entry.type.replaceAll('_', ' ')}</td>
                      <td>{entry.debitMinor ? formatMinor(entry.debitMinor) : '—'}</td>
                      <td>{entry.creditMinor ? formatMinor(entry.creditMinor) : '—'}</td>
                      <td>
                        <strong>{formatMinor(entry.balanceAfterMinor)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
