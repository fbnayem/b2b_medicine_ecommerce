// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { UserRole } from '@medsupply/shared-types';
import { apiClient } from '../api/client';
import { useAuthStore } from '../store/useAuth';
import { renderWithUi } from '../testing/render';
import { MedicineDetail } from './MedicineDetail';

/**
 * Who sees what on a medicine, and what the buttons actually send.
 *
 * The page is assembled from four independent role sets the server enforces
 * separately — catalogue managers, stock readers, pricing readers and the
 * narrower set allowed to see cost — so a single "is this an admin" predicate
 * would be right for a manager and wrong for everybody else. It was: the old
 * page decided whether to show stock with `role !== SHOP_OWNER`, which answers
 * `true` for a sales rep the server's `stockReaders` excludes.
 *
 * These are written so that flipping one predicate fails. Each role asserts
 * both what it gets *and* what it must not, because a screen that shows a
 * storekeeper a cost price is a leak and a screen that shows a rep a batch
 * table is an error card.
 */

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});
const get = vi.mocked(apiClient.get);
const patch = vi.mocked(apiClient.patch);

const MEDICINE = {
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
  costPriceMinor: 8250,
  defaultSellingPriceMinor: 9500,
  mrpMinor: 12000,
  minimumOrderQuantity: 1,
  productType: 'MEDICINE',
  classification: 'PRESCRIPTION',
  coldChain: false,
  isActive: true,
  totalAvailable: 240,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const BATCH = {
  _id: 'batch-1',
  medicineId: 'med-1',
  batchNumber: 'B-9001',
  manufacturingDate: '2026-01-01T00:00:00.000Z',
  expiryDate: '2027-01-01T00:00:00.000Z',
  costPriceMinor: 8250,
  receivedQuantity: 300,
  quantities: { onHand: 260, available: 240, reserved: 20, damaged: 0, picking: 0, packed: 0 },
  warehouseLocation: 'A-12',
  isBlocked: false,
  isQuarantined: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function serve(url: string) {
  if (url.startsWith('/inventory/medicines/')) return { data: { data: MEDICINE } };
  if (url.startsWith('/inventory/batches')) return { data: { data: [BATCH] } };
  if (url.startsWith('/inventory/movements'))
    return {
      data: {
        data: [
          {
            _id: 'mv-1',
            type: 'DAMAGE',
            quantity: 4,
            reason: 'Crushed in transit',
            createdAt: '2026-07-30T09:00:00.000Z',
            batchId: { batchNumber: 'B-9001' },
          },
        ],
      },
    };
  // Two lists, only one of which names this medicine.
  return {
    data: {
      data: [
        {
          _id: 'pl-1',
          reference: 'PL-2026-000001',
          name: 'Dhaka retail',
          isDefault: false,
          isActive: true,
          version: 1,
          lines: [{ medicineId: 'med-1', unitPriceMinor: 9000, discountPercent: 0 }],
        },
        {
          _id: 'pl-2',
          reference: 'PL-2026-000002',
          name: 'Chattogram wholesale',
          isDefault: false,
          isActive: true,
          version: 1,
          lines: [{ medicineId: 'med-2', unitPriceMinor: 8000, discountPercent: 0 }],
        },
      ],
    },
  };
}

function signedInAs(role: UserRole) {
  useAuthStore.setState({
    user: { _id: 'user-1', role } as never,
    accessToken: 'token',
    isAuthenticated: true,
  });
}

const mount = () =>
  renderWithUi(
    <MemoryRouter initialEntries={['/medicines/med-1']}>
      <Routes>
        <Route path="/medicines/:id" element={<MedicineDetail />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  cleanup();
  get.mockReset();
  patch.mockReset();
  get.mockImplementation((url: string) => Promise.resolve(serve(url)));
  patch.mockResolvedValue({ data: { data: MEDICINE } });
});
afterEach(() => cleanup());

describe('what each role is shown', () => {
  it('gives a manager the whole page, cost included', async () => {
    signedInAs(UserRole.MANAGER);
    mount();
    expect(await screen.findByRole('heading', { name: 'Napa 500 mg' })).toBeTruthy();

    expect(screen.getByRole('heading', { name: 'About this medicine' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Price' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Stock on hand' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Stock history' })).toBeTruthy();
    // Only management sees what a product cost us.
    expect(screen.getByText('What we pay')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take off the catalogue' })).toBeTruthy();
  });

  it('gives a storekeeper stock without any of the money', async () => {
    signedInAs(UserRole.STOREKEEPER);
    mount();
    expect(await screen.findByRole('heading', { name: 'Stock on hand' })).toBeTruthy();
    // `stockReaders` includes them; `pricing readers` and `COST_ROLES` do not.
    expect(screen.queryByRole('heading', { name: 'Price' })).toBeNull();
    expect(screen.queryByText('What we pay')).toBeNull();
    // They may record a movement but not overwrite a count or block a batch.
    expect(screen.getByRole('button', { name: 'Book in stock' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Correct the count' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });

  it('gives a sales rep the money without any of the stock', async () => {
    // The trap this file exists for. A rep is a pricing reader and *not* a
    // stock reader, so a predicate written as "not a shop owner" shows them a
    // batch table that `GET /inventory/batches` will refuse.
    signedInAs(UserRole.SALES);
    mount();
    expect(await screen.findByRole('heading', { name: 'Price' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Stock on hand' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Stock history' })).toBeNull();
    expect(screen.queryByText('What we pay')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    // And nothing asked the server for what it would have refused.
    const asked = get.mock.calls.map((call) => String(call[0]));
    expect(asked.some((url) => url.startsWith('/inventory/batches'))).toBe(false);
    expect(asked.some((url) => url.startsWith('/inventory/movements'))).toBe(false);
  });

  it('gives a shop owner what it is and how many, and nothing else', async () => {
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    expect(await screen.findByRole('heading', { name: 'About this medicine' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Stock on hand' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Price' })).toBeNull();
    expect(screen.queryByText('What we pay')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take off the catalogue' })).toBeNull();
  });
});

describe('changing the price without retyping the record', () => {
  it('sends one field, in integer minor units', async () => {
    signedInAs(UserRole.MANAGER);
    mount();
    const box = await screen.findByRole('textbox', { name: 'New price for a shop' });
    fireEvent.change(box, { target: { value: '99.90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change the price' }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]?.[0]).toBe('/inventory/medicines/med-1');
    // 9990 poisha exactly. `99.90 * 100` is 9989.999999999998 in IEEE 754.
    expect(patch.mock.calls[0]?.[1]).toEqual({ defaultSellingPriceMinor: 9990 });
  });

  it('refuses a price above the one printed on the pack, against the stored figure', async () => {
    signedInAs(UserRole.MANAGER);
    mount();
    const box = await screen.findByRole('textbox', { name: 'New price for a shop' });
    fireEvent.change(box, { target: { value: '150.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change the price' }));

    expect(
      await screen.findByText('The price cannot be above the price printed on the pack.'),
    ).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('the figures a manager reads at a glance', () => {
  it('states the margin against the printed price, and says so when there is none', async () => {
    signedInAs(UserRole.MANAGER);
    mount();
    // (12000 − 9500) / 12000 = 20.8%. Integer arithmetic on poisha throughout.
    // Twice, deliberately: once as the figure read at a glance and once in
    // the pricing list beneath it.
    expect(await screen.findAllByText('20.8%')).toHaveLength(2);
  });

  it('reports no answer rather than a margin of nil when no printed price is recorded', async () => {
    get.mockImplementation((url: string) => {
      if (url.startsWith('/inventory/medicines/'))
        return Promise.resolve({ data: { data: { ...MEDICINE, mrpMinor: undefined } } });
      return Promise.resolve(serve(url));
    });
    signedInAs(UserRole.MANAGER);
    mount();
    expect(await screen.findAllByText('No printed price recorded')).toBeTruthy();
  });

  it('names only the price lists that actually carry this medicine', async () => {
    signedInAs(UserRole.MANAGER);
    mount();
    expect(await screen.findByRole('link', { name: 'Dhaka retail' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Chattogram wholesale' })).toBeNull();
  });
});

describe('never shouting an enum at the reader', () => {
  it('spells out the classification instead of printing the stored word', async () => {
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    expect(await screen.findByText('On prescription')).toBeTruthy();
    expect(screen.queryByText('PRESCRIPTION')).toBeNull();
  });
});
