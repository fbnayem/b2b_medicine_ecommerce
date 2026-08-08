import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MedicineClassification, ProductType, type Medicine } from '@medsupply/shared-types';
import { MedicineFieldsSchema } from '@medsupply/validation';
import { parseMoney, toMoneyInputValue } from '@medsupply/utilities';
import { z } from 'zod';
import { apiClient, errorMessage, failureReference } from '../api/client';
import {
  Button,
  Card,
  ErrorState,
  Field,
  HelpTip,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Textarea,
  toast,
} from '../components/ui';
import { useZodForm } from '../lib/form';
import { useApiResource } from '../lib/query';
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

/**
 * An untouched optional field is **absent**, not an empty string.
 *
 * The server's optional fields are optional *or well-formed*: a barcode is at
 * least six characters, a picture is an address. An `<input>` nobody has typed
 * into holds `''`, which is neither — so the form refused to save and pointed
 * at a field the person had deliberately left alone. Blanking a value somebody
 * had previously set goes the same way: it must clear the field, not fail.
 *
 * The inner rule is unwrapped from the shared schema rather than restated, so a
 * change to what a barcode looks like still reaches this form.
 */
const blankIsAbsent = <T extends z.ZodType<string, string>>(field: z.ZodOptional<T>) =>
  z.union([z.literal(''), field.unwrap()]).transform((value) => (value === '' ? undefined : value));

/**
 * The same for a number box, where "empty" arrives as `NaN`.
 *
 * `valueAsNumber` on a cleared field gives `NaN`, and `z.number()` refuses it —
 * so "no maximum", which is the ordinary answer for almost every line in the
 * catalogue, could not be expressed.
 */
const blankIsNoLimit = <T extends z.ZodType<number, number>>(field: z.ZodOptional<T>) =>
  z
    .union([z.nan(), field.unwrap()])
    .transform((value) => (Number.isNaN(value) ? undefined : (value as number)));

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
    /*
     * Every optional field the form draws a control for. Each of these was
     * unsubmittable while blank, which is the state a create form opens in and
     * the state an edit form loads into for any line that never had one.
     */
    barcode: blankIsAbsent(MedicineFieldsSchema.shape.barcode),
    genericName: blankIsAbsent(MedicineFieldsSchema.shape.genericName),
    strength: blankIsAbsent(MedicineFieldsSchema.shape.strength),
    dosageForm: blankIsAbsent(MedicineFieldsSchema.shape.dosageForm),
    description: blankIsAbsent(MedicineFieldsSchema.shape.description),
    productImageUrl: blankIsAbsent(MedicineFieldsSchema.shape.productImageUrl),
    maximumOrderQuantity: blankIsNoLimit(MedicineFieldsSchema.shape.maximumOrderQuantity),
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

/**
 * Adding a medicine, and — for the first time in this product — changing one.
 *
 * `PATCH /inventory/medicines/:id` has been mounted, documented and tested
 * since the catalogue was built, and until now nothing called it. A typo in a
 * stock code, an MRP nobody recorded, a line that should be withdrawn: none of
 * them could be corrected from inside the application at all.
 *
 * The same nineteen fields either way. Editing one field at a time on the
 * detail page would mean nineteen separate patches, nineteen error surfaces,
 * and a rule spanning two fields — the trade price may not exceed the MRP —
 * that can be broken from whichever of the pair you are *not* editing. The
 * pricing card gets a one-field price change of its own precisely because that
 * is the change people make weekly; everything else belongs on a form.
 *
 * **No `version` field, deliberately.** `PriceList` and `Scheme` carry one, and
 * copying that here would be a migration wearing a one-line diff: a Mongoose
 * `default: 0` does not backfill documents that already exist, so `undefined`
 * would fail the equality check and every first edit of every existing medicine
 * would be refused as a conflict. The blast radius differs too — a price list is
 * replaced as a whole sheet, so a lost update destroys somebody's prices,
 * whereas a medicine is patched field-wise and two managers editing different
 * fields both land.
 */
export interface MedicineFormProps {
  mode?: 'create' | 'edit';
  /**
   * Present means "in a dialog": no page chrome, and the new medicine's id goes
   * back to the picker that opened it rather than the browser going to it.
   *
   * Only ever set alongside `mode: 'create'` — editing is reached from the
   * medicine's own page, where there is nothing to return to.
   */
  onCreated?: (record: Medicine) => void;
  onCancel?: () => void;
}

export function MedicineForm({ mode = 'create', onCreated, onCancel }: MedicineFormProps) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const params = useParams();
  const editing = mode === 'edit';
  const [failure, setFailure] = useState<{ message: string; reference?: string }>();

  const existing = useApiResource<Medicine>(
    keys.medicines.one(params.id!),
    `/inventory/medicines/${params.id}`,
    { enabled: editing },
  );

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

  /*
   * The record, poured back into the controls somebody types into.
   *
   * Money is the only conversion with a trap in it: the model holds integer
   * minor units and the field holds what a person would have typed, and the
   * obvious `minor / 100` is a float divide on a value that is only exact as an
   * integer. `toMoneyInputValue` does it as string surgery, so the amount
   * round-trips back through `parseMoney` unchanged.
   *
   * Keyed on `updatedAt` rather than on the object, so somebody's half-finished
   * edits are not wiped by a background refetch that returned the same record —
   * a refetch produces a new object identity every time.
   */
  useEffect(() => {
    const record = existing.data;
    if (!record) return;
    form.reset({
      sku: record.sku,
      barcode: record.barcode ?? '',
      brandName: record.brandName,
      genericName: record.genericName ?? '',
      manufacturer: record.manufacturer,
      strength: record.strength ?? '',
      dosageForm: record.dosageForm ?? '',
      packSize: record.packSize,
      unit: record.unit,
      category: record.category,
      description: record.description ?? '',
      productImageUrl: record.productImageUrl ?? '',
      costPrice: toMoneyInputValue(record.costPriceMinor),
      sellingPrice: toMoneyInputValue(record.defaultSellingPriceMinor),
      mrp: toMoneyInputValue(record.mrpMinor),
      minimumOrderQuantity: record.minimumOrderQuantity,
      maximumOrderQuantity: record.maximumOrderQuantity,
      productType: record.productType ?? ProductType.MEDICINE,
      classification: record.classification,
      coldChain: record.coldChain,
    } as MedicineValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data?.updatedAt, existing.data?._id]);

  const submit = form.handleSubmit(async (values) => {
    const { costPrice, sellingPrice, mrp, ...rest } = values;
    const cost = parseMoney(costPrice);
    const selling = parseMoney(sellingPrice);
    // Blank stays absent rather than becoming zero — `marginBasisPoints`
    // returns no answer without an MRP, which is different from a margin of nil.
    const printed = parseMoney(mrp);
    if (!cost.ok || !selling.ok) return;
    const body = {
      ...rest,
      barcode: rest.barcode || undefined,
      // Blank means "no picture", which is a value the server stores as
      // absent rather than as an empty string that fails its own URL rule.
      productImageUrl: rest.productImageUrl || undefined,
      costPriceMinor: cost.minor,
      defaultSellingPriceMinor: selling.minor,
      mrpMinor: printed.ok ? printed.minor : undefined,
    };
    try {
      /*
       * The whole object on a patch, not the fields that changed.
       *
       * `UpdateMedicineSchema` re-runs `validateMedicine` on the merged result,
       * and the rule it enforces is conditional: switching a line to
       * `PRESCRIPTION` makes generic name, strength and form required. Sending
       * a difference would let that rule read half of a record.
       */
      const response = editing
        ? await apiClient.patch(`/inventory/medicines/${params.id}`, body)
        : await apiClient.post('/inventory/medicines', body);
      queryClient.invalidateQueries({ queryKey: keys.medicines.all });
      // The catalogue list, the search, this medicine and its batches all sit
      // under that one prefix, which is the whole reason the keys are shaped
      // that way — a price changed here shows on the list without a reload.
      if (editing) toast.success(t('medicineForm.saved', { name: rest.brandName }));
      if (onCreated && !editing) {
        toast.success(t('medicineForm.saved', { name: rest.brandName }));
        onCreated(response.data.data as Medicine);
        return;
      }
      navigate(`/medicines/${editing ? params.id : response.data.data._id}`);
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

  const header = (
    <PageHeader
      routeId={editing ? 'medicine-edit' : 'medicine-new'}
      title={editing ? t('medicineForm.editTitle') : t('medicineForm.title')}
      description={editing ? t('medicineForm.editSubtitle') : t('medicineForm.subtitle')}
    />
  );

  /*
   * An empty form is the wrong thing to show while the record is on its way:
   * somebody would start typing into fields that are about to be overwritten by
   * the reset above. The failure case is separate again — a form prefilled from
   * nothing would save blanks over a medicine that loaded fine yesterday.
   */
  if (editing && existing.isLoading) {
    return (
      <>
        {header}
        <LoadingState label={t('medicineForm.loading')} />
      </>
    );
  }

  if (editing && existing.isError) {
    return (
      <>
        {header}
        <ErrorState
          message={errorMessage(existing.error, language, t('medicineForm.couldNotLoad'))}
          reference={failureReference(existing.error)}
          onRetry={() => void existing.refetch()}
        />
      </>
    );
  }

  const body = (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {failure && <ErrorState message={failure.message} reference={failure.reference} />}

      <div className="grid gap-4 md:grid-cols-2">
        {fields.map((field) => (
          <Field
            key={field.name}
            label={field.label}
            help={
              <HelpTip label={t('medicineHelp.about', { field: field.label })} body={field.help} />
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
                field.name === 'costPrice' || field.name === 'sellingPrice' || field.name === 'mrp'
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
          hint={t('hints.productType')}
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
          hint={t('hints.classification')}
        >
          {/*
            The catalogue, not the enum. This printed `PRESCRIPTION` and `OTC`
            lower-cased — database values, in English whatever the language was
            set to — while the medicine page two clicks away has rendered
            "On prescription" from `classification.*` since the phase that
            added it. One of the two was wrong and it was this one.
          */}
          <Select {...form.register('classification')}>
            {Object.values(MedicineClassification).map((value) => (
              <option key={value} value={value}>
                {t(`classification.${value}`)}
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
        hint={t('hints.productDescription')}
      >
        <Textarea
          placeholder={t('medicinePlaceholder.description')}
          {...form.register('description')}
        />
      </Field>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" onClick={() => (onCancel ? onCancel() : navigate(-1))}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
          {form.formState.isSubmitting
            ? t('medicineForm.saving')
            : editing
              ? t('medicineForm.saveChanges')
              : t('medicineForm.save')}
        </Button>
      </div>
    </form>
  );

  if (onCreated) return body;

  return (
    <>
      {header}
      <Card className="max-w-3xl">{body}</Card>
    </>
  );
}
