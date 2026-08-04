import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseMoney } from '@medsupply/utilities';
import type { Medicine, Supplier } from '@medsupply/shared-types';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Textarea,
  toast,
} from '../components/ui';
import { useApiCollection } from '../lib/query';
import { useLanguage } from '../lib/useLanguage';
import { formatMinor } from '../lib/finance';

interface Line {
  key: number;
  medicineId: string;
  quantity: string;
  unitCost: string;
}

let nextKey = 1;
const emptyLine = (): Line => ({ key: nextKey++, medicineId: '', quantity: '', unitCost: '' });

/** Whole units only. A cleared field is nothing ordered, never `NaN`. */
const units = (value: string) => {
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
};

export function PurchaseOrderForm() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  const suppliers = useApiCollection<Supplier>(['suppliers', false], '/purchasing/suppliers');
  const medicines = useApiCollection<Medicine>(
    ['medicines', 'all'],
    '/inventory/medicines?limit=100',
  );

  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [supplierReference, setSupplierReference] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  /** Money is the typed string until submit, then integer minor units. */
  const minor = (value: string) => {
    const parsed = parseMoney(value);
    return parsed.ok ? parsed.minor : 0;
  };

  const total = lines.reduce((sum, line) => sum + units(line.quantity) * minor(line.unitCost), 0);

  const patch = (key: number, next: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...next } : line)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(undefined);

    const filled = lines.filter((line) => line.medicineId && units(line.quantity) > 0);
    if (!supplierId || filled.length === 0) {
      setFailure({ message: t('purchasing.needSupplierAndLine') });
      return;
    }
    if (filled.some((line) => line.unitCost && !parseMoney(line.unitCost).ok)) {
      setFailure({ message: t('purchasing.badAmount') });
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiClient.post('/purchasing/orders', {
        supplierId,
        expectedDate: expectedDate || undefined,
        supplierReference: supplierReference || undefined,
        notes: notes || undefined,
        lines: filled.map((line) => ({
          medicineId: line.medicineId,
          orderedQuantity: units(line.quantity),
          unitCostMinor: minor(line.unitCost),
        })),
      });
      const created = response.data.data as { _id: string; reference: string };
      toast.success(t('purchasing.orderRaised', { reference: created.reference }));
      navigate(`/purchasing/orders/${created._id}`);
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('purchasing.orderFailed')),
        reference: failureReference(caught),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <PageHeader
        routeId="purchase-order-new"
        title={t('purchasing.newOrderTitle')}
        description={t('purchasing.newOrderSubtitle')}
        actions={<LinkButton to="/purchasing/orders">{t('purchasing.backToOrders')}</LinkButton>}
      />

      <Card className="max-w-4xl">
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          {failure && <ErrorState message={failure.message} reference={failure.reference} />}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('purchasing.supplier')} required>
              <Select
                required
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
              >
                <option value="">{t('purchasing.supplier')}</option>
                {(suppliers.data?.items ?? []).map((supplier) => (
                  <option key={supplier._id} value={supplier._id}>
                    {supplier.name} · {supplier.reference}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('purchasing.expectedDate')}>
              <Input
                type="date"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.target.value)}
              />
            </Field>
            <Field
              label={t('purchasing.supplierReference')}
              hint={t('purchasing.supplierReferenceHint')}
              className="sm:col-span-2"
            >
              <Input
                value={supplierReference}
                onChange={(event) => setSupplierReference(event.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-3">
            {lines.map((line) => (
              <div key={line.key} className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <Field label={t('purchasing.chooseMedicine')}>
                  <Select
                    value={line.medicineId}
                    onChange={(event) => patch(line.key, { medicineId: event.target.value })}
                  >
                    <option value="">{t('purchasing.chooseMedicine')}</option>
                    {(medicines.data?.items ?? []).map((medicine) => (
                      <option key={medicine._id} value={medicine._id}>
                        {medicine.brandName} · {medicine.strength}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('purchasing.quantity')}>
                  <Input
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(event) => patch(line.key, { quantity: event.target.value })}
                  />
                </Field>
                <Field label={t('purchasing.unitCost')}>
                  <Input
                    inputMode="decimal"
                    value={line.unitCost}
                    onChange={(event) => patch(line.key, { unitCost: event.target.value })}
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    // Never below one line: an order with no lines is not an
                    // order, and an empty form with no way back is a dead end.
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((current) => current.filter((entry) => entry.key !== line.key))
                    }
                  >
                    {t('purchasing.removeLine')}
                  </Button>
                </div>
              </div>
            ))}

            <div>
              <Button
                type="button"
                onClick={() => setLines((current) => [...current, emptyLine()])}
              >
                {t('purchasing.addLine')}
              </Button>
            </div>
          </div>

          <Field label={t('fields.notes')}>
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>

          <div className="flex items-center justify-between gap-4">
            <p className="text-lg font-semibold tabular-nums text-text">
              {t('purchasing.orderTotal')}: {formatMinor(total)}
            </p>
            <Button type="submit" variant="primary" busy={submitting}>
              {t('purchasing.saveOrder')}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
