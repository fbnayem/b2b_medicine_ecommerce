import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { parseMoney, toDateInputValue, toMoneyInputValue } from '@medsupply/utilities';
import type { Medicine, PriceListRecord } from '@medsupply/shared-types';
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
import { formatMinor } from '../lib/finance';

/**
 * The price sheet, created and edited in one place.
 *
 * Edited as a whole rather than line by line: a price list is worked on as a
 * sheet, and a partial update would need this form and the server to agree
 * about what the other thought the lines were. The version travelling with the
 * save is what stops two people editing the same sheet from discarding each
 * other's prices — which on a price list means charging a customer an amount
 * nobody chose.
 */

interface Line {
  key: number;
  medicineId: string;
  unitPrice: string;
  discountPercent: string;
}

let nextKey = 1;
const emptyLine = (): Line => ({
  key: nextKey++,
  medicineId: '',
  unitPrice: '',
  discountPercent: '0',
});

/** Money is the typed string until submit, then integer minor units. */
const minor = (value: string) => {
  const parsed = parseMoney(value);
  return parsed.ok ? parsed.minor : 0;
};

/** A cleared percentage is nothing off, never `NaN` into the payload. */
const percent = (value: string) => {
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
};

export function PriceListForm({ mode = 'create' }: { mode?: 'create' | 'edit' }) {
  const navigate = useNavigate();
  const params = useParams();
  const { t, language } = useLanguage();
  const editing = mode === 'edit';

  const medicines = useApiCollection<Medicine>(
    ['medicines', 'all'],
    '/inventory/medicines?limit=100',
  );
  const existing = useApiResource<PriceListRecord>(
    ['price-list', params.id],
    `/pricing/price-lists/${params.id}`,
    { enabled: editing },
  );

  const [form, setForm] = useState({
    name: '',
    description: '',
    validFrom: '',
    validTo: '',
    isDefault: false,
    isActive: true,
  });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [version, setVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  /*
   * Fills the form once the list arrives. Keyed on `updatedAt` rather than on
   * the record, so a background revalidation that changes nothing does not
   * throw away what the editor has typed since.
   */
  useEffect(() => {
    const record = existing.data;
    if (!record) return;
    setForm({
      name: record.name,
      description: record.description ?? '',
      validFrom: record.validFrom ? toDateInputValue(record.validFrom) : '',
      validTo: record.validTo ? toDateInputValue(record.validTo) : '',
      isDefault: record.isDefault,
      isActive: record.isActive,
    });
    setVersion(record.version);
    setLines(
      record.lines.length
        ? record.lines.map((line) => ({
            key: nextKey++,
            medicineId: line.medicineId,
            unitPrice: toMoneyInputValue(line.unitPriceMinor),
            discountPercent: String(line.discountPercent ?? 0),
          }))
        : [emptyLine()],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data?.updatedAt, existing.data?.version]);

  const patch = (key: number, next: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...next } : line)));

  const priced = lines.filter((line) => line.medicineId && parseMoney(line.unitPrice).ok);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    setSubmitting(true);
    const body = {
      name: form.name,
      description: form.description || undefined,
      isDefault: form.isDefault,
      isActive: form.isActive,
      validFrom: form.validFrom || undefined,
      validTo: form.validTo || undefined,
      lines: priced.map((line) => ({
        medicineId: line.medicineId,
        unitPriceMinor: minor(line.unitPrice),
        discountPercent: percent(line.discountPercent),
      })),
    };
    try {
      if (editing) {
        await apiClient.patch(`/pricing/price-lists/${params.id}`, { ...body, version });
      } else {
        await apiClient.post('/pricing/price-lists', body);
      }
      toast.success(t('priceLists.saved', { name: form.name }));
      navigate('/pricing/price-lists');
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('priceLists.saveFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (editing && existing.isLoading) {
    return (
      <>
        <PageHeader routeId="price-list-detail" title={t('priceLists.editTitle')} />
        <LoadingState label={t('priceLists.loading')} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        routeId={editing ? 'price-list-detail' : 'price-list-new'}
        title={editing ? t('priceLists.editTitle') : t('priceLists.addTitle')}
        description={t('priceLists.formSubtitle')}
        actions={<LinkButton to="/pricing/price-lists">{t('priceLists.title')}</LinkButton>}
      />

      <Card>
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
          {failure && <ErrorState message={failure.message} reference={failure.reference} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('priceLists.name')} required>
              <Input
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label={t('priceLists.validFrom')} hint={t('priceLists.openEndedHint')}>
              <Input
                type="date"
                value={form.validFrom}
                onChange={(event) => setForm({ ...form, validFrom: event.target.value })}
              />
            </Field>
            <Field label={t('priceLists.validTo')}>
              <Input
                type="date"
                value={form.validTo}
                onChange={(event) => setForm({ ...form, validTo: event.target.value })}
              />
            </Field>
            <Field label={t('priceLists.isDefault')} hint={t('priceLists.isDefaultHint')}>
              <Select
                value={form.isDefault ? 'yes' : 'no'}
                onChange={(event) => setForm({ ...form, isDefault: event.target.value === 'yes' })}
              >
                <option value="no">{t('common.off')}</option>
                <option value="yes">{t('common.on')}</option>
              </Select>
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
            <Field label={t('fields.notes')} className="sm:col-span-2">
              <Textarea
                rows={2}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-text">{t('priceLists.lines')}</h2>
            {lines.map((line) => (
              <div key={line.key} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <Field label={t('priceLists.medicine')}>
                  <Select
                    value={line.medicineId}
                    onChange={(event) => patch(line.key, { medicineId: event.target.value })}
                  >
                    <option value="">{t('priceLists.chooseMedicine')}</option>
                    {(medicines.data?.items ?? []).map((medicine) => (
                      <option key={medicine._id} value={medicine._id}>
                        {medicine.brandName} · {medicine.strength}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('priceLists.unitPrice')}>
                  <Input
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(event) => patch(line.key, { unitPrice: event.target.value })}
                  />
                </Field>
                <Field label={t('priceLists.discountPercent')}>
                  <Input
                    inputMode="decimal"
                    value={line.discountPercent}
                    onChange={(event) => patch(line.key, { discountPercent: event.target.value })}
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((current) => current.filter((entry) => entry.key !== line.key))
                    }
                  >
                    {t('priceLists.removeLine')}
                  </Button>
                </div>
              </div>
            ))}
            <div>
              <Button
                type="button"
                onClick={() => setLines((current) => [...current, emptyLine()])}
              >
                {t('priceLists.addLine')}
              </Button>
            </div>
          </div>

          <p className="text-sm text-muted">
            {t('priceLists.pricedCount', {
              count: priced.length,
              cheapest: priced.length
                ? formatMinor(Math.min(...priced.map((line) => minor(line.unitPrice))))
                : '—',
            })}
          </p>

          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => navigate('/pricing/price-lists')}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" busy={submitting}>
              {t('priceLists.save')}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
