import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toDateInputValue } from '@medsupply/utilities';
import type { Medicine, SchemeRecord, Shop } from '@medsupply/shared-types';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LinkButton,
  LoadingState,
  PageHeader,
  Select,
  Textarea,
  toast,
} from '../components/ui';
import { useApiCollection, useApiResource } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';

/**
 * Setting a free-goods offer.
 *
 * Naming no customer is the ordinary case — a supplier's 10+1 runs for
 * everybody — so the audience field defaults to that rather than to an empty
 * list nobody would think to fill.
 */

/** Whole units only. A cleared field is nothing, never `NaN` into the payload. */
const units = (value: string) => {
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
};

export function SchemeForm({ mode = 'create' }: { mode?: 'create' | 'edit' }) {
  const navigate = useNavigate();
  const params = useParams();
  const { t, language } = useLanguage();
  const editing = mode === 'edit';

  const medicines = useApiCollection<Medicine>(
    ['medicines', 'all'],
    '/inventory/medicines?limit=100',
  );
  const shops = useApiCollection<Shop>(['shops', 'all'], '/shops?limit=100');
  const existing = useApiResource<SchemeRecord>(
    ['scheme', params.id],
    `/pricing/schemes/${params.id}`,
    { enabled: editing },
  );

  const [form, setForm] = useState({
    name: '',
    medicineId: '',
    buyQuantity: '10',
    freeQuantity: '1',
    validFrom: '',
    validTo: '',
    isActive: true,
    notes: '',
  });
  const [shopIds, setShopIds] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  useEffect(() => {
    const record = existing.data;
    if (!record) return;
    setForm({
      name: record.name,
      medicineId: record.medicineId,
      buyQuantity: String(record.buyQuantity),
      freeQuantity: String(record.freeQuantity),
      validFrom: record.validFrom ? toDateInputValue(record.validFrom) : '',
      validTo: record.validTo ? toDateInputValue(record.validTo) : '',
      isActive: record.isActive,
      notes: record.notes ?? '',
    });
    setShopIds(record.shopIds);
    setVersion(record.version);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data?.updatedAt, existing.data?.version]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setSubmitting(true);
    const body = {
      name: form.name,
      medicineId: form.medicineId,
      buyQuantity: units(form.buyQuantity),
      freeQuantity: units(form.freeQuantity),
      validFrom: form.validFrom || undefined,
      validTo: form.validTo || undefined,
      shopIds,
      isActive: form.isActive,
      notes: form.notes || undefined,
    };
    try {
      if (editing) {
        await apiClient.patch(`/pricing/schemes/${params.id}`, { ...body, version });
      } else {
        await apiClient.post('/pricing/schemes', body);
      }
      toast.success(t('schemes.saved', { name: form.name }));
      navigate('/pricing/schemes');
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('schemes.saveFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (editing && existing.isLoading) {
    return (
      <main>
        <PageHeader routeId="scheme-detail" title={t('schemes.editTitle')} />
        <LoadingState label={t('schemes.loading')} />
      </main>
    );
  }

  return (
    <main>
      <PageHeader
        routeId={editing ? 'scheme-detail' : 'scheme-new'}
        title={editing ? t('schemes.editTitle') : t('schemes.addTitle')}
        description={t('schemes.formSubtitle')}
        actions={<LinkButton to="/pricing/schemes">{t('schemes.title')}</LinkButton>}
      />

      <Card className="max-w-3xl">
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
          {failure && <ErrorState message={failure.message} reference={failure.reference} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('schemes.name')} required>
              <Input
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label={t('schemes.medicine')} required>
              <Select
                required
                value={form.medicineId}
                onChange={(event) => setForm({ ...form, medicineId: event.target.value })}
              >
                <option value="">{t('schemes.chooseMedicine')}</option>
                {(medicines.data?.items ?? []).map((medicine) => (
                  <option key={medicine._id} value={medicine._id}>
                    {medicine.brandName} · {medicine.strength}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('schemes.buyQuantity')} hint={t('schemes.buyQuantityHint')} required>
              <Input
                required
                inputMode="numeric"
                value={form.buyQuantity}
                onChange={(event) => setForm({ ...form, buyQuantity: event.target.value })}
              />
            </Field>
            <Field label={t('schemes.freeQuantity')} required>
              <Input
                required
                inputMode="numeric"
                value={form.freeQuantity}
                onChange={(event) => setForm({ ...form, freeQuantity: event.target.value })}
              />
            </Field>
            <Field label={t('schemes.validFrom')} hint={t('schemes.openEndedHint')}>
              <Input
                type="date"
                value={form.validFrom}
                onChange={(event) => setForm({ ...form, validFrom: event.target.value })}
              />
            </Field>
            <Field label={t('schemes.validTo')}>
              <Input
                type="date"
                value={form.validTo}
                onChange={(event) => setForm({ ...form, validTo: event.target.value })}
              />
            </Field>
            <Field label={t('fields.status')}>
              <Select
                value={form.isActive ? 'active' : 'inactive'}
                onChange={(event) =>
                  setForm({ ...form, isActive: event.target.value === 'active' })
                }
              >
                <option value="active">{t('common.active')}</option>
                <option value="inactive">{t('common.inactive')}</option>
              </Select>
            </Field>
          </div>

          <Field label={t('schemes.audience')} hint={t('schemes.audienceHint')}>
            <div className="flex flex-col gap-1">
              {(shops.data?.items ?? []).map((shop) => (
                <label key={shop._id} className="flex min-h-11 items-center gap-2 text-text">
                  <input
                    type="checkbox"
                    checked={shopIds.includes(shop._id)}
                    onChange={(event) =>
                      setShopIds((current) =>
                        event.target.checked
                          ? [...current, shop._id]
                          : current.filter((id) => id !== shop._id),
                      )
                    }
                  />
                  {shop.name} · {shop.reference}
                </label>
              ))}
            </div>
          </Field>

          <p className="text-sm text-muted">
            {shopIds.length === 0
              ? t('schemes.everyCustomer')
              : t('schemes.namedCustomers', { count: shopIds.length })}
          </p>

          <Field label={t('fields.notes')}>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>

          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => navigate('/pricing/schemes')}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" busy={submitting}>
              {t('schemes.save')}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
