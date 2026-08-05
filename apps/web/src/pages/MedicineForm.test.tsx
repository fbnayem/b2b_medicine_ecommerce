// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { apiClient } from '../api/client';
import { renderWithUi } from '../testing/render';
import { MedicineForm } from './MedicineForm';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});
const get = vi.mocked(apiClient.get);
const patch = vi.mocked(apiClient.patch);

/** `jest-dom` is not installed here, so read the control rather than match it. */
const valueOf = (name: string) => (screen.getByRole('textbox', { name }) as HTMLInputElement).value;

/**
 * Every field says what it is for.
 *
 * The complaint this answers was "I didn't understand most of the functions
 * what to add in that fields". The form had nineteen controls, zero
 * placeholders and zero hints — "Sold as" and "Pack size" with nothing anywhere
 * saying what either meant, and the money format appearing only after somebody
 * got it wrong.
 *
 * These assert the guarantee rather than the wording: every control offers an
 * example, and every control has an explanation somebody can open. A test that
 * pinned the sentences would fail on every improvement to them.
 */

const mount = () =>
  renderWithUi(
    <MemoryRouter>
      <MedicineForm />
    </MemoryRouter>,
  );

describe('the medicine form explains itself', () => {
  it('shows an example inside every text box that has a shape worth showing', () => {
    mount();
    // The four whose format is impossible to guess from the label alone.
    expect(screen.getByPlaceholderText('NAP-500-10T')).toBeTruthy(); // stock code
    expect(screen.getByPlaceholderText('10 x 10 tablets')).toBeTruthy(); // pack size
    expect(screen.getByPlaceholderText('Box')).toBeTruthy(); // sold as
    expect(screen.getByPlaceholderText('95.00')).toBeTruthy(); // a price
  });

  it('offers an explanation beside every field, not only the awkward ones', () => {
    mount();
    const explanations = screen.getAllByRole('button', { name: /^About / });
    // Nineteen controls: sixteen text boxes, two selects and the cold-chain
    // checkbox. A form that quietly lost one would fail here.
    expect(explanations.length).toBeGreaterThanOrEqual(19);
  });

  it('says how the most expensive field to get wrong actually works', () => {
    mount();
    // "Sold as" decides what one of the number in an order means. A shop
    // ordering five tablets when they meant five boxes is the mistake this
    // form most easily allows, so the warning is a visible hint *and* an
    // explanation — the only field that gets both.
    expect(screen.getByText('What one of the number in an order means.')).toBeTruthy();

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'About Sold as' }));
    expect(screen.getByText(/a shop ordering 5 gets 5 tablets/)).toBeTruthy();
  });

  it('can record a product photograph, which nothing could before', () => {
    mount();
    // The field was omitted from the schema, so its URL rule ran nowhere and
    // no screen collected it — a picture could only ever be set by a script.
    expect(screen.getByPlaceholderText('https://…/napa-500.webp')).toBeTruthy();
  });
});

/**
 * Changing a medicine, which no screen in this product could do.
 *
 * `PATCH /inventory/medicines/:id` was mounted, documented and covered by an
 * API test, and had never had a caller — so these assert the two halves that
 * make the endpoint reachable: the record arrives in the controls, and what
 * leaves is the shape the server's own schema will accept.
 */
const RECORD = {
  _id: 'med-1',
  reference: 'MED-2026-000001',
  sku: 'NAP-500-10T',
  brandName: 'Napa',
  genericName: 'Paracetamol',
  manufacturer: 'Beximco Pharmaceuticals',
  strength: '500 mg',
  dosageForm: 'Tablet',
  packSize: '10 x 10 tablets',
  unit: 'Box',
  category: 'Painkillers',
  description: '',
  productImageUrl: '',
  // 8250 and 9500 poisha. The form must show 82.50 and 95.00, and a naive
  // `minor / 100` would be a float divide on a value only exact as an integer.
  costPriceMinor: 8250,
  defaultSellingPriceMinor: 9500,
  mrpMinor: 12000,
  minimumOrderQuantity: 1,
  maximumOrderQuantity: undefined,
  productType: 'MEDICINE',
  classification: 'PRESCRIPTION',
  coldChain: false,
  isActive: true,
  updatedAt: '2026-08-01T04:00:00.000Z',
};

describe('editing a medicine', () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    get.mockResolvedValue({ data: { data: RECORD } });
    patch.mockResolvedValue({ data: { data: RECORD } });
  });
  afterEach(() => cleanup());

  const mountEdit = () =>
    renderWithUi(
      <MemoryRouter initialEntries={['/medicines/med-1/edit']}>
        <Routes>
          <Route path="/medicines/:id/edit" element={<MedicineForm mode="edit" />} />
        </Routes>
      </MemoryRouter>,
    );

  it('fills the form from the record, money included', async () => {
    mountEdit();
    await waitFor(() => expect(valueOf('Stock code')).toBe('NAP-500-10T'));
    // The second argument is the abort signal the query layer supplies.
    expect(get.mock.calls[0]?.[0]).toBe('/inventory/medicines/med-1');
    // The reason `toMoneyInputValue` exists rather than a divide.
    expect(valueOf('What we pay')).toBe('82.50');
    expect(valueOf('What the shop pays')).toBe('95.00');
    expect(valueOf('MRP (printed on the pack)')).toBe('120.00');
  });

  it('patches the whole record in minor units, not the fields that changed', async () => {
    mountEdit();
    await waitFor(() => expect(valueOf('Stock code')).toBe('NAP-500-10T'));

    fireEvent.change(screen.getByRole('textbox', { name: 'What the shop pays' }), {
      target: { value: '99.90' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    const [url, body] = patch.mock.calls[0]!;
    expect(url).toBe('/inventory/medicines/med-1');
    // Integer poisha, never 9989.999999999998 — and the untouched fields go
    // too, because the server re-runs a rule that spans several of them.
    expect(body).toMatchObject({
      defaultSellingPriceMinor: 9990,
      costPriceMinor: 8250,
      mrpMinor: 12000,
      sku: 'NAP-500-10T',
      classification: 'PRESCRIPTION',
    });
  });

  it('refuses a trade price above the printed one before the server has to', async () => {
    mountEdit();
    await waitFor(() => expect(valueOf('Stock code')).toBe('NAP-500-10T'));

    // A pharmacy may not legally sell above the MRP, so this loses the shop
    // money on every unit. Caught while the hands are still on the field.
    fireEvent.change(screen.getByRole('textbox', { name: 'What the shop pays' }), {
      target: { value: '150.00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('The trade price cannot be above the MRP.')).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });

  it('says so while the record is still coming, rather than showing empty boxes', () => {
    // An empty form here invites somebody to type into fields that are about
    // to be overwritten by the record landing.
    get.mockReturnValue(new Promise(() => {}));
    mountEdit();
    expect(screen.getByText(/Loading this medicine/)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Stock code' })).toBeNull();
  });

  it('does not offer a form to save when the record could not be loaded', async () => {
    // Saving a blank form over a medicine that loaded fine yesterday is the
    // failure this avoids.
    get.mockRejectedValue(new Error('Network Error'));
    mountEdit();
    expect(await screen.findByRole('button', { name: /Try again/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });
});
