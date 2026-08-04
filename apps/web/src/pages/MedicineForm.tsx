import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MedicineClassification } from '@medsupply/shared-types';
import { MedicineFieldsSchema } from '@medsupply/validation';
import { parseMoney } from '@medsupply/utilities';
import { z } from 'zod';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '../components/ui';
import { useZodForm } from '../lib/form';
import { useLanguage } from '../lib/useLanguage';

/**
 * The catalogue entry form, validated against the server's own field rules.
 *
 * Two fields cannot come straight from `MedicineFieldsSchema`: it wants integer
 * minor units, and a form holds what somebody typed. So the money pair is
 * omitted and re-added as text validated through `parseMoney` — the same
 * parser the rest of the application uses, which matters because the old code
 * did `Math.round(Number(input) * 100)`. That is **floating-point arithmetic on
 * money**, which `AGENTS.md` forbids outright: `19.99 * 100` is
 * `1998.9999999999998` in IEEE 754, and the rounding that hides it is not
 * something to rely on for a price list.
 *
 * Everything else — how long a brand name may be, what a barcode looks like —
 * is the server's rule, imported rather than restated.
 */
const money = z.string().refine((value) => parseMoney(value).ok, {
  message: 'Enter an amount like 12.50.',
});

const MedicineFormSchema = MedicineFieldsSchema.omit({
  costPriceMinor: true,
  defaultSellingPriceMinor: true,
  isActive: true,
  productImageUrl: true,
}).extend({
  costPrice: money,
  sellingPrice: money,
});

type MedicineValues = z.input<typeof MedicineFormSchema>;
type MedicineOutput = z.output<typeof MedicineFormSchema>;

/** `[field, label key, input type]`, in the order somebody reads a pack. */
const TEXT_FIELDS: Array<[keyof MedicineOutput & string, string, string]> = [
  ['sku', 'sku', 'text'],
  ['barcode', 'barcode', 'text'],
  ['brandName', 'brandName', 'text'],
  ['genericName', 'genericName', 'text'],
  ['manufacturer', 'manufacturer', 'text'],
  ['strength', 'strength', 'text'],
  ['dosageForm', 'dosageForm', 'text'],
  ['packSize', 'packSize', 'text'],
  ['unit', 'unit', 'text'],
  ['category', 'category', 'text'],
  ['costPrice', 'costPrice', 'text'],
  ['sellingPrice', 'sellingPrice', 'text'],
  ['minimumOrderQuantity', 'minimumOrderQuantity', 'number'],
  ['maximumOrderQuantity', 'maximumOrderQuantity', 'number'],
];

const OPTIONAL = new Set(['barcode', 'maximumOrderQuantity']);

export function MedicineForm() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  const form = useZodForm<MedicineValues, MedicineOutput>(MedicineFormSchema, {
    defaultValues: {
      sku: '',
      brandName: '',
      genericName: '',
      manufacturer: '',
      strength: '',
      dosageForm: '',
      packSize: '',
      unit: '',
      category: '',
      description: '',
      costPrice: '',
      sellingPrice: '',
      minimumOrderQuantity: 1,
      classification: MedicineClassification.PRESCRIPTION,
      coldChain: false,
    } as MedicineValues,
  });

  const submit = form.handleSubmit(async (values) => {
    const { costPrice, sellingPrice, ...rest } = values;
    const cost = parseMoney(costPrice);
    const selling = parseMoney(sellingPrice);
    if (!cost.ok || !selling.ok) return;
    try {
      const response = await apiClient.post('/inventory/medicines', {
        ...rest,
        barcode: rest.barcode || undefined,
        costPriceMinor: cost.minor,
        defaultSellingPriceMinor: selling.minor,
      });
      navigate(`/medicines/${response.data.data._id}`);
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('medicineForm.saveFailed')),
        reference: failureReference(caught),
      });
    }
  });

  const errors = form.formState.errors as Record<string, { message?: string } | undefined>;

  return (
    <main>
      <PageHeader
        routeId="medicine-new"
        title={t('medicineForm.title')}
        description={t('medicineForm.subtitle')}
      />
      <Card className="max-w-3xl">
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          {failure && <ErrorState message={failure.message} reference={failure.reference} />}

          <div className="grid gap-4 md:grid-cols-2">
            {TEXT_FIELDS.map(([name, key, type]) => (
              <Field
                key={name}
                label={t(`medicineForm.${key}`)}
                required={!OPTIONAL.has(name)}
                error={errors[name]?.message}
              >
                <Input
                  type={type}
                  min={type === 'number' ? 0 : undefined}
                  inputMode={
                    name === 'costPrice' || name === 'sellingPrice' ? 'decimal' : undefined
                  }
                  {...form.register(
                    name as never,
                    type === 'number' ? { valueAsNumber: true } : undefined,
                  )}
                />
              </Field>
            ))}

            <Field label={t('medicineForm.classification')} error={errors.classification?.message}>
              <Select {...form.register('classification')}>
                {Object.values(MedicineClassification).map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll('_', ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>

            <label className="flex min-h-11 items-center gap-2 self-end text-text">
              <input type="checkbox" {...form.register('coldChain')} />
              {t('medicineForm.coldChain')}
            </label>
          </div>

          <Field label={t('medicineForm.description')} error={errors.description?.message}>
            <Textarea {...form.register('description')} />
          </Field>

          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => navigate(-1)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('medicineForm.saving') : t('medicineForm.save')}
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
