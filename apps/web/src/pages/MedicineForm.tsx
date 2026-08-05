import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MedicineClassification, ProductType } from '@medsupply/shared-types';
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
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../lib/useLanguage';
import { keys } from '../lib/queryKeys';

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

/** Blank is a real answer here: most of the catalogue has no MRP recorded yet. */
const optionalMoney = z.string().refine((value) => value === '' || parseMoney(value).ok, {
  message: 'Enter an amount like 12.50, or leave it blank.',
});

const MedicineFormSchema = MedicineFieldsSchema.omit({
  costPriceMinor: true,
  defaultSellingPriceMinor: true,
  mrpMinor: true,
  isActive: true,
  productImageUrl: true,
})
  .extend({
    costPrice: money,
    sellingPrice: money,
    mrp: optionalMoney,
  })
  .superRefine((value, context) => {
    /*
     * A pharmacy may not legally sell above the price printed on the pack, so a
     * trade price above the MRP means they lose money on every unit. The server
     * refuses it too — this is here so the person typing finds out while their
     * hands are still on the field.
     */
    const mrp = parseMoney(value.mrp);
    const trade = parseMoney(value.sellingPrice);
    if (mrp.ok && trade.ok && trade.minor > mrp.minor) {
      context.addIssue({
        code: 'custom',
        path: ['sellingPrice'],
        message: 'The trade price cannot be above the MRP.',
      });
    }

    /*
     * A prescription line has to say what it actually is.
     *
     * The clinical fields are optional on the schema now, because a shampoo has
     * no generic name and inventing one puts fabricated clinical data in the
     * column a pharmacist reads. The condition is `classification`, not the
     * shelf — and the server enforces exactly this, so saying it here only
     * changes *when* somebody finds out, not whether.
     */
    if (value.classification === MedicineClassification.PRESCRIPTION) {
      for (const field of ['genericName', 'strength', 'dosageForm'] as const) {
        if (!String(value[field] ?? '').trim()) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: 'A prescription medicine needs this.',
          });
        }
      }
    }
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
  ['mrp', 'mrp', 'text'],
  ['minimumOrderQuantity', 'minimumOrderQuantity', 'number'],
  ['maximumOrderQuantity', 'maximumOrderQuantity', 'number'],
];

const OPTIONAL = new Set(['barcode', 'maximumOrderQuantity', 'mrp']);

/**
 * The three that are required only on a prescription line.
 *
 * A static `required` marker would either put an asterisk on a nappy's generic
 * name or leave it off a controlled drug's, and both read as the form being
 * wrong about its own rules.
 */
const CLINICAL = new Set(['genericName', 'strength', 'dosageForm']);

export function MedicineForm() {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
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
      mrp: '',
      minimumOrderQuantity: 1,
      productType: ProductType.MEDICINE,
      classification: MedicineClassification.PRESCRIPTION,
      coldChain: false,
    } as MedicineValues,
  });

  const submit = form.handleSubmit(async (values) => {
    const { costPrice, sellingPrice, mrp, ...rest } = values;
    const cost = parseMoney(costPrice);
    const selling = parseMoney(sellingPrice);
    // Blank stays absent rather than becoming zero — `marginBasisPoints`
    // returns no answer without an MRP, which is different from a margin of nil.
    const printed = parseMoney(mrp);
    if (!cost.ok || !selling.ok) return;
    try {
      const response = await apiClient.post('/inventory/medicines', {
        ...rest,
        barcode: rest.barcode || undefined,
        costPriceMinor: cost.minor,
        defaultSellingPriceMinor: selling.minor,
        mrpMinor: printed.ok ? printed.minor : undefined,
      });
      queryClient.invalidateQueries({ queryKey: keys.medicines.all });
      navigate(`/medicines/${response.data.data._id}`);
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, language, t('medicineForm.saveFailed')),
        reference: failureReference(caught),
      });
    }
  });

  const errors = form.formState.errors as Record<string, { message?: string } | undefined>;
  const prescription = form.watch('classification') === MedicineClassification.PRESCRIPTION;

  return (
    <>
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
                required={!OPTIONAL.has(name) && (!CLINICAL.has(name) || prescription)}
                error={errors[name]?.message}
              >
                <Input
                  type={type}
                  min={type === 'number' ? 0 : undefined}
                  inputMode={
                    name === 'costPrice' || name === 'sellingPrice' || name === 'mrp'
                      ? 'decimal'
                      : undefined
                  }
                  {...form.register(
                    name as never,
                    type === 'number' ? { valueAsNumber: true } : undefined,
                  )}
                />
              </Field>
            ))}

            <Field label={t('medicineForm.productType')} error={errors.productType?.message}>
              <Select {...form.register('productType')}>
                {Object.values(ProductType).map((value) => (
                  <option key={value} value={value}>
                    {t(`productType.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>

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
    </>
  );
}
