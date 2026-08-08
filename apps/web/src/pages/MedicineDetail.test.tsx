// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

/*
 * A sentinel that only exists past the fold, so "the fold hides the rest" is
 * assertable as text rather than as a pixel height jsdom cannot measure.
 */
const LONG_TAIL = 'Store below 30 degrees Celsius away from sunlight.';
const LONG_BODY =
  'Paracetamol relieves pain and fever in adults and children alike. '.repeat(20) + LONG_TAIL;

/*
 * The served shape: groups already bucketed and already in reading order.
 * The order test asserts the page *preserves* this order — a page that
 * alphabetised or regrouped would put the safety panel below the sales copy.
 */
const MONOGRAPH = {
  lang: 'en',
  requested: 'en',
  source: { name: 'AROGGA', scrapedAt: '2026-06-01T00:00:00.000Z' },
  groups: [
    {
      group: 'BRIEF',
      sections: [{ title: 'Indication of Napa 500 mg', body: 'Fever and mild pain.' }],
    },
    { group: 'OVERVIEW', sections: [{ title: 'Overview of Napa 500 mg', body: LONG_BODY }] },
    {
      group: 'QUICK_TIP',
      sections: [{ body: 'Take after food.' }, { body: 'Do not exceed four doses in a day.' }],
    },
    {
      group: 'SAFETY',
      sections: [
        {
          body: 'Take only when a doctor has weighed the risk.',
          safety: { type: 'PREGNANCY', tag: 'SAFE_IF_PRESCRIBED' },
        },
        {
          body: 'Do not drink alcohol while taking this.',
          safety: { type: 'ALCOHOL', tag: 'UNSAFE' },
        },
      ],
    },
    { group: 'BODY', sections: [{ body: 'A trusted household analgesic.' }] },
  ],
};

const suggested = (overrides: Record<string, unknown>) => ({
  reference: 'MED-2026-000002',
  manufacturer: 'Square Pharmaceuticals',
  genericName: 'Paracetamol',
  packSize: '10',
  unit: 'box',
  defaultSellingPriceMinor: 9000,
  // Above the trade price on purpose: the card only draws a struck-through
  // figure and a margin badge when there is a real gap between the two.
  mrpMinor: 12000,
  totalAvailable: 12,
  ...overrides,
});

/*
 * One genuine group and the advert. The promoted item is deliberately nothing
 * like the medicine — that is what the supplier's bestseller carousel actually
 * returns on a prescription line, and why it must never sit under "What else
 * could be sent".
 */
const ALTERNATIVES = [
  {
    kind: 'SAME_INGREDIENT',
    items: [suggested({ _id: 'med-2', brandName: 'Ace', strength: '500 mg' })],
  },
  { kind: 'PROMOTED', items: [suggested({ _id: 'med-9', brandName: 'Vitamin C Serum' })] },
];

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
  // Most specific first: both of these also start with '/inventory/medicines/'.
  if (url.startsWith('/inventory/medicines/med-1/content')) return { data: { data: MONOGRAPH } };
  if (url.startsWith('/inventory/medicines/med-1/alternatives'))
    return { data: { data: ALTERNATIVES } };
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
  if (url.startsWith('/pricing/schemes'))
    return {
      data: {
        data: [
          {
            _id: 'scheme-1',
            reference: 'SCH-2026-000001',
            name: 'Napa 10+1',
            medicineId: 'med-1',
            buyQuantity: 10,
            freeQuantity: 1,
            shopIds: [],
            isActive: true,
            version: 1,
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
    /*
     * (12000 − 9500) / 12000 = 20.8%. Integer arithmetic on poisha throughout.
     *
     * Once, now. It used to appear twice — a stat tile above and the pricing
     * list below — and the tile was removed when the product block took over
     * the same job: the block states it as "You make 20.8%", which is the
     * sentence a buyer reads, and the pricing list states the bare figure a
     * manager compares against cost.
     */
    expect(await screen.findAllByText('20.8%')).toHaveLength(1);
    expect(screen.getByText('You make 20.8%')).toBeTruthy();
  });

  it('reports no answer rather than a margin of nil when no printed price is recorded', async () => {
    get.mockImplementation((url: string) => {
      // The medicine itself, exactly: a prefix match here also swallowed the
      // `/content` and `/alternatives` children and served each a Medicine,
      // which is how this test once handed the alternatives section a record
      // where an array belongs.
      if (url === '/inventory/medicines/med-1')
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

describe("the manufacturer's copy", () => {
  it('renders the groups in the order the server sent, under an attribution heading', async () => {
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    // The attribution is the section's own heading, so whose words these are
    // cannot be scrolled past — and the caution sits beside it, not at the end.
    expect(
      await screen.findByRole('heading', {
        name: 'Product information supplied by the manufacturer',
      }),
    ).toBeTruthy();
    expect(
      screen.getByText('This is not clinical advice. Ask a pharmacist before acting on any of it.'),
    ).toBeTruthy();

    const section = document.getElementById('monograph')!;
    const headings = within(section)
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    // Served order, preserved: brief facts, prose, tips, safety, sales copy.
    expect(headings).toEqual([
      'Brief',
      'Overview',
      'Quick tips',
      'Safety advice',
      'About this product',
    ]);
  });

  it('asks in the language the reader is using', async () => {
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    await screen.findByRole('heading', { name: 'Napa 500 mg' });
    const asked = get.mock.calls.map((call) => String(call[0]));
    expect(asked).toContain('/inventory/medicines/med-1/content?lang=en');
  });

  it('says a safety verdict in words, never in colour alone', async () => {
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    // The question and the verdict are both text. A colour-blind pharmacist
    // reads exactly what a colour-sighted one does.
    expect(await screen.findByText('Pregnancy')).toBeTruthy();
    expect(screen.getByText('Safe if prescribed')).toBeTruthy();
    expect(screen.getByText('Alcohol')).toBeTruthy();
    expect(screen.getByText('Unsafe')).toBeTruthy();
  });

  it('renders quick tips as a list', async () => {
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    const tip = await screen.findByText('Take after food.');
    expect(tip.tagName).toBe('LI');
    expect(screen.getByText('Do not exceed four doses in a day.').tagName).toBe('LI');
  });

  it('folds a long passage and unfolds it on request', async () => {
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    const more = await screen.findByRole('button', { name: 'Show more' });
    // The tail of the passage is genuinely absent, not merely off-screen.
    expect(screen.queryByText(new RegExp(LONG_TAIL))).toBeNull();
    expect(more.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(more);
    expect(screen.getByText(new RegExp(LONG_TAIL))).toBeTruthy();
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less.getAttribute('aria-expanded')).toBe('true');
  });

  it('states the fallback when the requested language has no copy', async () => {
    get.mockImplementation((url: string) => {
      if (url.startsWith('/inventory/medicines/med-1/content'))
        return Promise.resolve({ data: { data: { ...MONOGRAPH, requested: 'bn' } } });
      return Promise.resolve(serve(url));
    });
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    await screen.findByRole('heading', {
      name: 'Product information supplied by the manufacturer',
    });
    /*
     * By hook rather than by sentence: the copy itself belongs to the i18n
     * catalogue and may be reworded there without this test caring.
     */
    expect(document.querySelector('[data-test="monograph-language"]')).toBeTruthy();
  });

  it('shows no monograph section for a line with no copy', async () => {
    get.mockImplementation((url: string) => {
      if (url.startsWith('/inventory/medicines/med-1/content'))
        return Promise.resolve({ data: { data: null } });
      return Promise.resolve(serve(url));
    });
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    await screen.findByRole('heading', { name: 'Napa 500 mg' });
    expect(
      screen.queryByRole('heading', {
        name: 'Product information supplied by the manufacturer',
      }),
    ).toBeNull();
  });
});

describe('advertising is labelled as advertising', () => {
  it('keeps the promotion out of the alternatives and heads it as a promotion', async () => {
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    expect(await screen.findByRole('heading', { name: 'Promoted products' })).toBeTruthy();
    expect(
      screen.getByText('The supplier advertises these. They are not alternatives to this product.'),
    ).toBeTruthy();

    // The genuine group renders where it always did; the advert does not.
    const alternatives = document.getElementById('alternatives')!;
    expect(within(alternatives).getByText('Ace 500 mg')).toBeTruthy();
    expect(within(alternatives).queryByText('Promoted products')).toBeNull();
    expect(within(alternatives).queryByText('Vitamin C Serum')).toBeNull();

    const promoted = document.getElementById('promoted')!;
    expect(within(promoted).getByText('Vitamin C Serum')).toBeTruthy();
  });
});

/*
 * The product block, and the two prices a pharmacy decides on.
 *
 * A consumer shop shows a struck-through price and a discount badge. Here the
 * struck-through figure is the MRP printed on the pack, the prominent one is
 * what the pharmacy pays, and the gap is what they earn — so the badge says
 * margin. Getting that pairing backwards, or showing a struck-through figure
 * where there is no gap, would misrepresent the trade in the one place it is
 * decided.
 */
describe('what a buyer is shown about the price', () => {
  it('shows a shop owner the price, which this page used to hide from them', async () => {
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    await screen.findByRole('heading', { name: 'Napa 500 mg' });

    // ৳95.00 trade against ৳120.00 printed. The buyer reads this figure on the
    // catalogue card and then clicked into the product; it vanished here,
    // because the page gated it behind a rule that excludes the customer.
    expect(screen.getAllByText('৳95.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('৳120.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('You make 20.8%').length).toBeGreaterThan(0);
  });

  it('says the list price is not necessarily this customer’s price', async () => {
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    await screen.findByRole('heading', { name: 'Napa 500 mg' });
    // The server prices the order from their price list and any running offer.
    // A page that implied otherwise would quote a figure the invoice
    // contradicts.
    expect(
      screen.getByText(
        'Your price list and any offer running on this line are applied when you order.',
      ),
    ).toBeTruthy();
  });

  it('draws no struck-through price where there is no margin to strike', async () => {
    // Every imported line is in this state until a goods receipt supplies a
    // real cost: trade equals MRP, so a struck-through identical figure would
    // read as a broken discount.
    get.mockImplementation((url: string) => {
      if (url.startsWith('/inventory/medicines/med-1/content'))
        return Promise.resolve({ data: { data: null } });
      if (url.startsWith('/inventory/medicines/med-1/alternatives'))
        return Promise.resolve({ data: { data: [] } });
      if (url.startsWith('/inventory/medicines/'))
        return Promise.resolve({ data: { data: { ...MEDICINE, mrpMinor: 9500 } } });
      return Promise.resolve({ data: { data: [] } });
    });
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    await screen.findByRole('heading', { name: 'Napa 500 mg' });
    expect(screen.queryByText('You make 0%')).toBeNull();
  });
});

describe('what a suggested product card carries', () => {
  it('shows the molecule, the maker, the pack, both prices and the stock', async () => {
    signedInAs(UserRole.SHOP_OWNER);
    mount();
    const alternatives = await screen.findByText('Ace 500 mg');
    const card = alternatives.closest('[data-test^="product-card-"]')!;
    expect(card, 'the suggestion must render as a card, not a bare row').toBeTruthy();

    // Everything below was already on the wire — `alternativesFor` returns the
    // whole medicine plus its free stock — and the old row showed four of them.
    expect(within(card as HTMLElement).getByText('Paracetamol')).toBeTruthy();
    expect(within(card as HTMLElement).getByText('Square Pharmaceuticals')).toBeTruthy();
    expect(within(card as HTMLElement).getByText('10 box')).toBeTruthy();
    expect(within(card as HTMLElement).getByText('৳90.00')).toBeTruthy();
    expect(within(card as HTMLElement).getByText('৳120.00')).toBeTruthy();
    expect(within(card as HTMLElement).getByText('You make 25%')).toBeTruthy();
    expect(within(card as HTMLElement).getByText('12 in stock')).toBeTruthy();
  });

  it('offers no way to order to somebody who cannot place an order', async () => {
    signedInAs(UserRole.MANAGER);
    mount();
    await screen.findByText('Ace 500 mg');
    // Staff order on a shop's behalf from order entry, having first chosen the
    // customer. A bare "add to order" here would have no basket to add to.
    expect(screen.queryByTestId('add-MED-2026-000002')).toBeNull();
  });
});
