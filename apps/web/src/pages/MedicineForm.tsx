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
  HelpTip,
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

/*
 * `productImageUrl` stays in.
 *
 * It used to be omitted here and never collected, so the field had no control
 * on any screen — and the shared schema's rule about it, that the value is
 * either an `http(s)` address or a path we already hold, ran nowhere on the
 * client. It is a real field on the model, the catalogue renders it, and the
 * import populates it; leaving it out meant it could only ever be set by a
 * script.
 */
const MedicineFormSchema = MedicineFieldsSchema.omit({
  costPriceMinor: true,
  defaultSellingPriceMinor: true,
  mrpMinor: true,
  isActive: true,
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

/**
 * The order somebody reads a pack in, and what each field needs said about it.
 *
 * **Every string is a literal `t('…')` call, and the verbosity is the point.**
 * This was a tuple of `[field, key, type]` and the label was looked up as
 * `` t(`medicineForm.${key}`) `` — a template literal, which
 * `catalogueKeys.test.ts` deliberately does not match, because it cannot prove
 * the interpolated half names a real leaf. One invisible family was tolerable.
 * Adding a placeholder, a hint and a help sentence the same way would have made
 * four, and a misspelling in any of them renders as `medicineHelp.sku` on the
 * screen with every test in the repository green.
 *
 * Built inside the component so `t` is in scope. About sixty gated call sites
 * in exchange for a defect class the gate can see.
 */
interface FieldSpec {
  name: keyof MedicineOutput & string;
  label: string;
  help: string;
  placeholder?: string;
  hint?: string;
  type: 'text' | 'number';
}

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
      productImageUrl: '',
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
        // Blank means "no picture", which is a value the server stores as
        // absent rather than as an empty string that fails its own URL rule.
        productImageUrl: rest.productImageUrl || undefined,
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

  const fields: FieldSpec[] = [
    {
      name: 'sku',
      type: 'text',
      label: t('medicineForm.sku'),
      help: t('medicineHelp.sku'),
      placeholder: t('medicinePlaceholder.sku'),
    },
    {
      name: 'barcode',
      type: 'text',
      label: t('medicineForm.barcode'),
      help: t('medicineHelp.barcode'),
      placeholder: t('medicinePlaceholder.barcode'),
      hint: t('medicineHint.barcode'),
    },
    {
      name: 'brandName',
      type: 'text',
      label: t('medicineForm.brandName'),
      help: t('medicineHelp.brandName'),
      placeholder: t('medicinePlaceholder.brandName'),
    },
    {
      name: 'genericName',
      type: 'text',
      label: t('medicineForm.genericName'),
      help: t('medicineHelp.genericName'),
      placeholder: t('medicinePlaceholder.genericName'),
    },
    {
      name: 'manufacturer',
      type: 'text',
      label: t('medicineForm.manufacturer'),
      help: t('medicineHelp.manufacturer'),
      placeholder: t('medicinePlaceholder.manufacturer'),
    },
    {
      name: 'strength',
      type: 'text',
      label: t('medicineForm.strength'),
      help: t('medicineHelp.strength'),
      placeholder: t('medicinePlaceholder.strength'),
    },
    {
      name: 'dosageForm',
      type: 'text',
      label: t('medicineForm.dosageForm'),
      help: t('medicineHelp.dosageForm'),
      placeholder: t('medicinePlaceholder.dosageForm'),
    },
    {
      name: 'packSize',
      type: 'text',
      label: t('medicineForm.packSize'),
      help: t('medicineHelp.packSize'),
      placeholder: t('medicinePlaceholder.packSize'),
    },
    {
      /*
       * Both a hint and a help sentence, alone among these. A shop ordering
       * five tablets when they meant five boxes is the most expensive mistake
       * this form allows, and the warning has to be readable without anybody
       * pressing anything.
       */
      name: 'unit',
      type: 'text',
      label: t('medicineForm.unit'),
      help: t('medicineHelp.unit'),
      placeholder: t('medicinePlaceholder.unit'),
      hint: t('medicineHint.unit'),
    },
    {
      name: 'category',
      type: 'text',
      label: t('medicineForm.category'),
      help: t('medicineHelp.category'),
      placeholder: t('medicinePlaceholder.category'),
    },
    {
      name: 'costPrice',
      type: 'text',
      label: t('medicineForm.costPrice'),
      help: t('medicineHelp.costPrice'),
      placeholder: t('medicinePlaceholder.costPrice'),
      hint: t('medicineHint.costPrice'),
    },
    {
      name: 'sellingPrice',
      type: 'text',
      label: t('medicineForm.sellingPrice'),
      help: t('medicineHelp.sellingPrice'),
      placeholder: t('medicinePlaceholder.sellingPrice'),
      hint: t('medicineHint.sellingPrice'),
    },
    {
      name: 'mrp',
      type: 'text',
      label: t('medicineForm.mrp'),
      help: t('medicineHelp.mrp'),
      placeholder: t('medicinePlaceholder.mrp'),
      hint: t('medicineHint.mrp'),
    },
    {
      name: 'minimumOrderQuantity',
      type: 'number',
      label: t('medicineForm.minimumOrderQuantity'),
      help: t('medicineHelp.minimumOrderQuantity'),
      placeholder: t('medicinePlaceholder.minimumOrderQuantity'),
    },
    {
      name: 'maximumOrderQuantity',
      type: 'number',
      label: t('medicineForm.maximumOrderQuantity'),
      help: t('medicineHelp.maximumOrderQuantity'),
      placeholder: t('medicinePlaceholder.maximumOrderQuantity'),
      hint: t('medicineHint.maximumOrderQuantity'),
    },
    {
      name: 'productImageUrl',
      type: 'text',
      label: t('medicineForm.productImageUrl'),
      help: t('medicineHelp.productImageUrl'),
      placeholder: t('medicinePlaceholder.productImageUrl'),
      hint: t('medicineHint.productImageUrl'),
    },
  ];

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
            {fields.map((field) => (
              <Field
                key={field.name}
                label={field.label}
                help={
                  <HelpTip
                    label={t('medicineHelp.about', { field: field.label })}
                    body={field.help}
                  />
                }
                hint={field.hint}
                required={
                  !OPTIONAL.has(field.name) &&
                  field.name !== 'productImageUrl' &&
                  (!CLINICAL.has(field.name) || prescription)
                }
                error={errors[field.name]?.message}
              >
                <Input
                  type={field.type}
                  placeholder={field.placeholder}
                  min={field.type === 'number' ? 0 : undefined}
                  inputMode={
                    field.name === 'costPrice' ||
                    field.name === 'sellingPrice' ||
                    field.name === 'mrp'
                      ? 'decimal'
                      : undefined
                  }
                  {...form.register(
                    field.name as never,
                    field.type === 'number' ? { valueAsNumber: true } : undefined,
                  )}
                />
              </Field>
            ))}

            <Field
              label={t('medicineForm.productType')}
              help={
                <HelpTip
                  label={t('medicineHelp.about', { field: t('medicineForm.productType') })}
                  body={t('medicineHelp.productType')}
                />
              }
              error={errors.productType?.message}
            >
              <Select {...form.register('productType')}>
                {Object.values(ProductType).map((value) => (
                  <option key={value} value={value}>
                    {t(`productType.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label={t('medicineForm.classification')}
              help={
                <HelpTip
                  label={t('medicineHelp.about', { field: t('medicineForm.classification') })}
                  body={t('medicineHelp.classification')}
                />
              }
              error={errors.classification?.message}
            >
              <Select {...form.register('classification')}>
                {Object.values(MedicineClassification).map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll('_', ' ').toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex min-h-11 items-center gap-1 self-end">
              <label className="flex items-center gap-2 text-text">
                <input type="checkbox" {...form.register('coldChain')} />
                {t('medicineForm.coldChain')}
              </label>
              <HelpTip
                label={t('medicineHelp.about', { field: t('medicineForm.coldChain') })}
                body={t('medicineHelp.coldChain')}
              />
            </div>
          </div>

          <Field
            label={t('medicineForm.description')}
            help={
              <HelpTip
                label={t('medicineHelp.about', { field: t('medicineForm.description') })}
                body={t('medicineHelp.description')}
              />
            }
            error={errors.description?.message}
          >
            <Textarea
              placeholder={t('medicinePlaceholder.description')}
              {...form.register('description')}
            />
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
