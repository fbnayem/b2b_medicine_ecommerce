import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  UpdateMedicineSchema,
  UpdatePriceListSchema,
  UpdateSchemeSchema,
  UpdateShopSchema,
  patchSchemaOf,
} from '@medsupply/validation';

/**
 * A patch changes what it mentions and nothing else.
 *
 * This is a data-loss rule rather than a validation nicety. Every update
 * endpoint here parses the body and hands the result straight to
 * `findByIdAndUpdate`, so any field the schema *invents* is written over
 * whatever was stored. `.partial()` looks like it prevents that and does not:
 * in Zod 4 a defaulted field keeps its default through `.partial()`, so a body
 * that mentions one field arrives at Mongoose carrying several.
 *
 * What that cost, before `patchSchemaOf`:
 *
 * - Correcting a typo in a customer's **name** set their credit limit to zero,
 *   their payment terms back to thirty days, their negotiated discount to zero,
 *   and **deleted every delivery address they had** — so their next order had
 *   nowhere to go.
 * - Editing a medicine's **pack size** cleared `coldChain`, which is a safety
 *   property on vaccines and insulin, and set `isActive` back to `true`,
 *   quietly returning a withdrawn medicine to the sellable catalogue.
 *
 * Neither is visible in a diff of the request, which is why it survived: the
 * client sent one field and the audit log's `after` looked like a normal edit.
 */

test('a shop patch touches only what it names', () => {
  const patch = UpdateShopSchema.parse({ name: 'Bismillah Pharmacy Ltd' });

  assert.deepEqual(
    Object.keys(patch),
    ['name'],
    'anything else here is written over stored data the caller never mentioned',
  );
  assert.equal('creditLimit' in patch, false);
  assert.equal('paymentTermsDays' in patch, false);
  assert.equal('defaultDiscount' in patch, false);
  assert.equal(
    'deliveryAddresses' in patch,
    false,
    'an empty array here is not "no change", it is "delete them all"',
  );
});

test('a medicine patch does not clear cold chain or resurrect a withdrawal', () => {
  const patch = UpdateMedicineSchema.parse({ packSize: '20s' });

  assert.equal(
    'coldChain' in patch,
    false,
    'a false here silently removes the refrigeration requirement from a vaccine',
  );
  assert.equal(
    'isActive' in patch,
    false,
    'a true here puts a withdrawn medicine back on sale, which is the one ' +
      'direction a catalogue must never move by accident',
  );
  assert.equal('minimumOrderQuantity' in patch, false);
  assert.equal(patch.packSize, '20s');
});

test('the commercial patches keep the same rule', () => {
  const list = UpdatePriceListSchema.parse({ name: 'Chain retail' });
  assert.equal('isActive' in list, false, 'a patch must not silently reactivate a retired list');
  assert.equal('isDefault' in list, false);
  assert.equal('lines' in list, false, 'an empty array here erases every price on the sheet');

  const scheme = UpdateSchemeSchema.parse({ name: 'Ace 20+3' });
  assert.equal('isActive' in scheme, false);
  assert.equal(
    'shopIds' in scheme,
    false,
    'an empty array widens an offer from a named few to every customer',
  );
});

test('a value the caller does send still arrives', () => {
  // The rule is "change what you mention", not "ignore everything".
  assert.equal(UpdateShopSchema.parse({ creditLimit: 0 }).creditLimit, 0);
  assert.equal(UpdateMedicineSchema.parse({ isActive: false }).isActive, false);
  assert.equal(UpdateMedicineSchema.parse({ coldChain: true }).coldChain, true);
});

test('the rule detects the defect it was written for', () => {
  /*
   * The self-test. `patchSchemaOf` is a few lines and its whole value is that
   * it differs from `.partial()`; if a Zod upgrade ever made the two agree,
   * every assertion above would keep passing for the wrong reason and this one
   * would fail.
   */
  const fields = z.object({
    name: z.string(),
    coldChain: z.boolean().default(false),
  });

  const naive = fields.partial().parse({ name: 'x' });
  assert.equal(
    'coldChain' in naive,
    true,
    'if this is ever false, `.partial()` has started behaving and this helper ' +
      'can be retired — until then it is load bearing',
  );

  const patched = patchSchemaOf(fields).parse({ name: 'x' });
  assert.equal('coldChain' in patched, false);
});
