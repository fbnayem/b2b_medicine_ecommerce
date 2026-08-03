import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { formatMinor } from '../lib/finance';
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui';

type ReadyPackage = {
  _id: string;
  reference: string;
  barcode: string;
  packageCount: number;
  orderId: { _id?: string; reference: string };
  invoiceId: { reference: string; grandTotalMinor: number };
  deliveryId?: string;
};

/**
 * Packed orders waiting to be handed to a rider.
 *
 * This screen rendered `<article>` cards that were not links, carried no action
 * and led nowhere — a storekeeper could see that a package was ready and had no
 * way to do the next thing from here. The next thing is handing it over, which
 * happens on the delivery, so every row now goes there.
 */
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
      setError('Unable to load the packages that are ready.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <>
      <PageHeader
        routeId="fulfilment-ready"
        title="Ready to hand over"
        description="Packed and invoiced. Open one to hand it to the delivery person."
        actions={
          <Link
            to="/fulfilment"
            className="flex min-h-11 items-center rounded-md border border-border px-4"
          >
            Back to picking
          </Link>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : loading ? (
        <LoadingState label="Loading the packages that are ready" />
      ) : data.length === 0 ? (
        <EmptyState
          title="Nothing is waiting to go out"
          description="Packages appear here once they have been packed and invoiced."
          action={
            <Link
              to="/fulfilment"
              className="flex min-h-11 items-center rounded-md bg-brand px-4 text-on-brand"
            >
              Go to the picking queue
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((item) => (
            <Card key={item._id} className="p-0">
              {/*
                The whole card is the link. `row-<reference>` uses the
                server-generated package reference, per the test-id contract —
                never an ObjectId.
              */}
              <Link
                data-test={`row-${item.reference}`}
                to={
                  item.deliveryId
                    ? `/deliveries/${item.deliveryId}`
                    : `/deliveries?package=${encodeURIComponent(item.reference)}`
                }
                className="flex h-full flex-col gap-1 rounded-lg p-4 hover:bg-surface-hover"
              >
                <span className="text-sm text-text-muted">{item.reference}</span>
                <span className="text-lg font-semibold text-text">{item.orderId.reference}</span>
                <span className="text-text-muted">
                  {item.invoiceId.reference} · {formatMinor(item.invoiceId.grandTotalMinor)}
                </span>
                <span className="text-sm text-text-muted">
                  {item.packageCount} package{item.packageCount === 1 ? '' : 's'} · barcode{' '}
                  {item.barcode}
                </span>
                <span className="mt-2 font-medium text-brand">Hand over →</span>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
