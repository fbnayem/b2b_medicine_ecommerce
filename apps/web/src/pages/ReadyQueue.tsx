import { Link } from 'react-router-dom';
import { Card, EmptyState, LinkButton, PageHeader, Resource } from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatMinor } from '../lib/finance';

interface ReadyPackage {
  _id: string;
  reference: string;
  barcode: string;
  packageCount: number;
  orderId: { _id?: string; reference: string };
  invoiceId: { reference: string; grandTotalMinor: number };
  deliveryId?: string;
}

/**
 * Packed orders waiting to be handed to a rider.
 *
 * This screen rendered `<article>` cards that were not links, carried no action
 * and led nowhere — a storekeeper could see that a package was ready and had no
 * way to do the next thing from here. The next thing is handing it over, which
 * happens on the delivery, so every row now goes there.
 */
export function ReadyQueue() {
  const { t } = useLanguage();
  const ready = useApiCollection<ReadyPackage>(['fulfilment-ready'], '/fulfilment/ready');

  return (
    <>
      <PageHeader
        routeId="fulfilment-ready"
        title={t('fulfilment.readyTitle')}
        description={t('fulfilment.readySubtitle')}
        actions={<LinkButton to="/fulfilment">{t('fulfilment.backToPicking')}</LinkButton>}
      />

      <Resource
        query={ready}
        loadingLabel={t('fulfilment.readyLoading')}
        errorMessageFallback={t('fulfilment.readyCouldNotLoad')}
        empty={
          <EmptyState
            title={t('fulfilment.readyNone')}
            description={t('fulfilment.readyNoneBody')}
            action={
              <LinkButton variant="primary" to="/fulfilment">
                {t('fulfilment.goToPicking')}
              </LinkButton>
            }
          />
        }
      >
        {(page) => (
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {page.items.map((item) => (
              <li key={item._id}>
                <Card className="h-full p-0">
                  {/*
                    The whole card is the link. `row-<reference>` uses the
                    server-generated package reference, per the test-id contract
                    — never an ObjectId.
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
                    <span className="text-lg font-semibold text-text">
                      {item.orderId.reference}
                    </span>
                    <span className="text-text-muted">
                      {item.invoiceId.reference} · {formatMinor(item.invoiceId.grandTotalMinor)}
                    </span>
                    <span className="text-sm text-text-muted">
                      {item.packageCount === 1
                        ? t('fulfilment.onePackage')
                        : t('fulfilment.packages', { count: item.packageCount })}{' '}
                      · {t('fulfilment.barcode', { code: item.barcode })}
                    </span>
                    <span className="mt-2 font-medium text-brand">
                      {t('fulfilment.handOver')} →
                    </span>
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Resource>
    </>
  );
}
