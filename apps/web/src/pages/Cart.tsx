import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useCart } from '../store/useCart';
import './inventory.css';
import { formatMinor } from '../lib/finance';
import { toast } from '../components/ui';
const money = formatMinor;
export function Cart() {
  const { items, setQuantity, remove, draftId, setDraftId } = useCart();
  const subtotal = items.reduce(
    (sum, item) => sum + item.medicine.defaultSellingPriceMinor * item.quantity,
    0,
  );
  async function save() {
    const body = {
      items: items.map((item) => ({
        medicineId: item.medicine._id,
        requestedQuantity: item.quantity,
        shopNotes: item.notes,
      })),
    };
    const response = draftId
      ? await apiClient.patch(`/orders/drafts/${draftId}`, body)
      : await apiClient.post('/orders/drafts', body);
    setDraftId(response.data.data._id);
    toast.success('Draft saved.');
  }
  return (
    <main className="inventory-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Ordering</p>
          <h1>Your cart</h1>
          <p>Stock is not reserved until manager approval.</p>
        </div>
        <Link className="secondary-button" to="/medicines">
          Continue shopping
        </Link>
      </header>
      {items.length === 0 ? (
        <section className="state">
          <h2>Your cart is empty</h2>
          <Link to="/medicines">Browse medicines</Link>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Unit price</th>
                    <th>Quantity</th>
                    <th>Estimate</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(({ medicine, quantity }) => (
                    <tr key={medicine._id}>
                      <td>
                        <strong>
                          {medicine.brandName} {medicine.strength}
                        </strong>
                        <small>
                          MOQ {medicine.minimumOrderQuantity}
                          {medicine.maximumOrderQuantity
                            ? ` / Max ${medicine.maximumOrderQuantity}`
                            : ''}
                        </small>
                      </td>
                      <td>{money(medicine.defaultSellingPriceMinor)}</td>
                      <td>
                        <input
                          aria-label={`Quantity for ${medicine.brandName}`}
                          type="number"
                          min={medicine.minimumOrderQuantity}
                          max={medicine.maximumOrderQuantity}
                          value={quantity}
                          onChange={(event) =>
                            setQuantity(medicine._id, Number(event.target.value))
                          }
                        />
                      </td>
                      <td>{money(medicine.defaultSellingPriceMinor * quantity)}</td>
                      <td>
                        <button onClick={() => remove(medicine._id)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-bottom">
              <strong>Estimated subtotal</strong>
              <strong>{money(subtotal)}</strong>
            </div>
          </section>
          <div className="actions">
            <button className="secondary-button" onClick={() => void save()}>
              Save draft
            </button>
            <Link className="primary-button" to="/checkout">
              Checkout
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
