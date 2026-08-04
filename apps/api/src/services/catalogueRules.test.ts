import test from 'node:test';
import assert from 'node:assert/strict';
import { MedicineClassification, ProductType } from '@medsupply/shared-types';
import { CreateMedicineSchema } from '@medsupply/validation';

/**
 * What a catalogue line has to say about itself, and when.
 *
 * The catalogue required a generic name, a strength and a dosage form on every
 * row. That is right for a tablet and impossible for a box of nappies, so a
 * distributor stocking anything that is not a drug had to invent all three —
 * fabricated clinical data in the column a pharmacist reads a real one from.
 *
 * The rule is now conditional, and the condition is **`classification`, not
 * `productType`**. Which shelf something sits on is a merchandising choice that
 * drifts; whether it is dispensed against a prescription is a fact about the
 * product. The Arogga sample proved the distinction the hard way — a sunblock
 * and a dermatological cream both arrive filed under "Medicine" and neither
 * carries a generic name, because neither needs one.
 *
 * None of the 350 tests in this repository asserted any of this before the rule
 * was relaxed, which is why relaxing it was silent.
 */

function line(overrides: Record<string, unknown> = {}) {
  return {
    sku: 'TEST-1',
    brandName: 'Test Line',
    manufacturer: 'Test Manufacturer',
    packSize: '10 Tablet',
    unit: 'Strip',
    category: 'Analgesic',
    costPriceMinor: 10_000,
    defaultSellingPriceMinor: 12_000,
    mrpMinor: 15_000,
    classification: MedicineClassification.OTC,
    ...overrides,
  };
}

test('a prescription medicine must name its active ingredient, strength and form', () => {
  const refused = CreateMedicineSchema.safeParse(
    line({ classification: MedicineClassification.PRESCRIPTION }),
  );

  assert.equal(
    refused.success,
    false,
    'a prescription line with no clinical identity was accepted',
  );
  const paths = refused.error!.issues.map((issue) => issue.path.join('.')).sort();
  assert.deepEqual(
    paths,
    ['dosageForm', 'genericName', 'strength'],
    'all three are named, so the person filling the form is told everything that is missing ' +
      'rather than one field at a time',
  );
});

test('a prescription medicine that names all three is accepted', () => {
  const accepted = CreateMedicineSchema.safeParse(
    line({
      classification: MedicineClassification.PRESCRIPTION,
      genericName: 'Upadacitinib',
      strength: '15mg',
      dosageForm: 'Tablet',
    }),
  );
  assert.equal(accepted.success, true, JSON.stringify(accepted.error?.issues));
});

test('an over-the-counter line needs none of them', () => {
  /*
   * The box of nappies. Before this, importing it meant either inventing a
   * generic name for a nappy or leaving the line out of the catalogue
   * entirely — and a distributor who genuinely stocks it has to be able to
   * price it, pick it and invoice it like anything else on the van.
   */
  const accepted = CreateMedicineSchema.safeParse(
    line({
      brandName: 'Kinder Diaper Comfy Fits Pants Jumbo S',
      productType: ProductType.BABY_CARE,
      packSize: '42 Pcs',
      unit: '42 Pcs',
      category: 'Disposable Diapers',
    }),
  );
  assert.equal(accepted.success, true, JSON.stringify(accepted.error?.issues));
  assert.equal(accepted.data!.productType, ProductType.BABY_CARE);
  assert.equal(accepted.data!.genericName, undefined, 'absent, rather than an empty string');
});

test('the shelf defaults to MEDICINE, so every row that predates this stays correct', () => {
  // The migration this avoids: the catalogue already holds drugs and nothing
  // else, so the default has to be the answer that was already true.
  const parsed = CreateMedicineSchema.parse(
    line({
      classification: MedicineClassification.PRESCRIPTION,
      genericName: 'Paracetamol',
      strength: '500mg',
      dosageForm: 'Tablet',
    }),
  );
  assert.equal(parsed.productType, ProductType.MEDICINE);
});

test('the rule detects what it claims to, so a clean run means something', () => {
  /*
   * `classification` is the whole condition. If this ever passes with
   * PRESCRIPTION, the conditional half has stopped firing and every
   * prescription line in the catalogue can be saved without an active
   * ingredient — which is the state this test was written to prevent
   * returning to.
   */
  const otc = CreateMedicineSchema.safeParse(line({ classification: MedicineClassification.OTC }));
  const rx = CreateMedicineSchema.safeParse(
    line({ classification: MedicineClassification.PRESCRIPTION }),
  );
  assert.equal(otc.success, true, 'the same line without the prescription flag must be fine');
  assert.equal(rx.success, false, 'and with it, must not be');
});

test('an imported image path is checked like any other field', () => {
  /*
   * The catalogue import attaches a file from the bundle rather than a URL, and
   * `z.string().url()` refused it — which meant the importer had to set the
   * field *after* validation, making it the one part of an imported row that
   * nothing checked.
   */
  const local = CreateMedicineSchema.safeParse(
    line({ productImageUrl: 'images/12507/napro-a-plus-500-1-faf82da1d1-clean.webp' }),
  );
  assert.equal(local.success, true, JSON.stringify(local.error?.issues));

  const remote = CreateMedicineSchema.safeParse(
    line({ productImageUrl: 'https://cdn.example.com/napa.png' }),
  );
  assert.equal(remote.success, true);

  const nonsense = CreateMedicineSchema.safeParse(line({ productImageUrl: 'not an image' }));
  assert.equal(nonsense.success, false, 'and it is still a check rather than a free-text field');
});
