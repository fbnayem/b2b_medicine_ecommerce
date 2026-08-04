import { useMutation } from '@tanstack/react-query';
import { apiClient, errorMessage, failureReference } from '../api/client';
import { useCart } from '../store/useCart';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  LinkButton,
  PageHeader,
  toast,
  type Column,
} from '../components/ui';
import { useLanguage } from '../lib/useLanguage';
import { formatMinor } from '../lib/finance';

interface Line {
  medicineId: string;
  brandName: string;
  strength: string;
  unitPriceMinor: number;
  quantity: number;
  minimum: number;
  maximum?: number;
}

/**
 * The basket, which is a table people edit rather than only read.
 *
 * Two things changed beyond the styling. The quantity box now says what the
 * limits are instead of only enforcing them silently through `min`/`max`, and
 * saving a draft reports its own failure — it previously called the API with no
 * catch at all, so a save that failed looked exactly like a save that worked.
 */
export function Cart() {
  const { t, language } = useLanguage();
  const { items, setQuantity, remove, draftId, setDraftId } = useCart();

  const subtotal = items.reduce(
    (sum, item) => sum + item.medicine.defaultSellingPriceMinor * item.quantity,
    0,
  );

  const save = useMutation({
    mutationFn: async () => {
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
      return response.data.data._id as string;
    },
    onSuccess: (id) => {
      setDraftId(id);
      toast.success(t('cart.draftSaved'));
    },
    onError: (caught) =>
      toast.error(errorMessage(caught, language, t('lists.couldNotLoad')), {
        reference: failureReference(caught),
      }),
  });

  const lines: Line[] = items.map(({ medicine, quantity }) => ({
    medicineId: medicine._id,
    brandName: medicine.brandName,
    // Blank rather than absent: a line without a strength is a shampoo, and
    // the display concatenates the two.
    strength: medicine.strength ?? '',
    unitPriceMinor: medicine.defaultSellingPriceMinor,
    quantity,
    minimum: medicine.minimumOrderQuantity,
    maximum: medicine.maximumOrderQuantity,
  }));

  const columns: ReadonlyArray<Column<Line>> = [
    {
      key: 'medicine',
      header: t('fields.medicine'),
      cell: (line) => (
        <div>
          <p className="font-medium text-text">
            {line.brandName} {line.strength}
          </p>
          <p className="text-sm text-text-muted">
            {line.maximum
              ? t('cart.minimumAndMaximum', { minimum: line.minimum, maximum: line.maximum })
              : t('cart.minimum', { minimum: line.minimum })}
          </p>
        </div>
      ),
    },
    {
      key: 'unit-price',
      header: t('cart.unitPrice'),
      numeric: true,
      cell: (line) => formatMinor(line.unitPriceMinor),
    },
    {
      key: 'quantity',
      header: t('fields.quantity'),
      numeric: true,
      cell: (line) => (
        <input
          aria-label={t('cart.quantityFor', { brand: line.brandName })}
          type="number"
          min={line.minimum}
          max={line.maximum}
          value={line.quantity}
          onChange={(event) => setQuantity(line.medicineId, Number(event.target.value))}
          className="min-h-11 w-24 rounded-md border border-border bg-surface px-3 text-end tabular-nums text-text"
        />
      ),
    },
    {
      key: 'line-total',
      header: t('cart.lineTotal'),
      numeric: true,
      cell: (line) => formatMinor(line.unitPriceMinor * line.quantity),
    },
    {
      key: 'remove',
      header: '',
      label: '',
      cell: (line) => (
        <Button
          variant="ghost"
          size="sm"
          label={`${t('actions.remove')} ${line.brandName}`}
          onClick={() => remove(line.medicineId)}
        >
          {t('actions.remove')}
        </Button>
      ),
    },
  ];

  return (
    <main>
      <PageHeader
        routeId="cart"
        title={t('cart.title')}
        description={t('cart.subtitle')}
        actions={<LinkButton to="/medicines">{t('cart.keepBrowsing')}</LinkButton>}
      />
      {lines.length === 0 ? (
        <EmptyState
          title={t('cart.empty')}
          description={t('cart.emptyBody')}
          action={
            <LinkButton variant="primary" to="/medicines">
              {t('cart.browse')}
            </LinkButton>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <DataTable
            caption={t('cart.title')}
            columns={columns}
            rows={lines}
            rowKey={(line) => line.medicineId}
          />
          <Card className="flex items-center justify-between">
            <span className="font-medium text-text">{t('cart.subtotal')}</span>
            <span className="text-lg font-semibold tabular-nums text-text">
              {formatMinor(subtotal)}
            </span>
          </Card>
          <div className="flex flex-wrap justify-end gap-2">
            <Button busy={save.isPending} onClick={() => save.mutate()}>
              {t('cart.saveDraft')}
            </Button>
            <LinkButton variant="primary" to="/checkout">
              {t('cart.checkout')}
            </LinkButton>
          </div>
        </div>
      )}
    </main>
  );
}
