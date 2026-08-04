import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AskProvider } from '../../../src/components';
import OrderEntryScreen from './order-entry';

/**
 * The rep's order-entry screen, rendered.
 *
 * The four claims here are the ones that cost money or waste a visit if they
 * are wrong, and none of them is visible to a type-checker:
 *
 *   - the picker offers the rep's own customers and nothing else;
 *   - a remembered customer the rep may **no longer** order for is dropped
 *     rather than silently restored;
 *   - the total on screen is the server's answer, not this screen's arithmetic;
 *   - with no connection the order is refused out loud and **not** submitted.
 *
 * The last one is the reason this file exists. An order needs a live price and
 * a live credit check, so it cannot be queued the way a delivery can — and the
 * failure mode of getting that wrong is a rep telling a shopkeeper an order is
 * placed when nothing left the handset.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

// `mock`-prefixed by jest's rule: a factory may not close over anything else.
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../src/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

const SHOPS = [
  {
    _id: 'shop-1',
    name: 'Rahman Pharmacy',
    reference: 'SHP-2026-000001',
    primaryPhone: '01711000001',
    territory: 'Dhaka North',
    deliveryAddresses: [
      { _id: 'addr-1', label: 'Shop', line1: '12 Mirpur Road', city: 'Dhaka', isDefault: true },
    ],
  },
  {
    _id: 'shop-2',
    name: 'Karim Medicine Corner',
    reference: 'SHP-2026-000002',
    primaryPhone: '01711000002',
    territory: 'Dhaka North',
    deliveryAddresses: [
      { _id: 'addr-2', label: 'Shop', line1: '5 Kazipara', city: 'Dhaka', isDefault: true },
    ],
  },
];

const NAPA = {
  _id: 'med-1',
  reference: 'MED-2026-000001',
  sku: 'NAPA-500',
  brandName: 'Napa',
  genericName: 'Paracetamol',
  manufacturer: 'Beximco',
  strength: '500mg',
  dosageForm: 'Tablet',
  packSize: '10x10',
  unit: 'strip',
  category: 'Analgesic',
  costPriceMinor: 8000,
  defaultSellingPriceMinor: 12000,
  minimumOrderQuantity: 1,
  classification: 'OTC',
  coldChain: false,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** The server's answer for one Napa: a price list has taken it below the default. */
const QUOTE = {
  shopName: 'Rahman Pharmacy',
  items: [
    {
      medicineId: 'med-1',
      medicineSnapshot: { brandName: 'Napa', strength: '500mg', sku: 'NAPA-500' },
      requestedQuantity: 1,
      freeQuantity: 0,
      estimatedUnitPriceMinor: 9500,
      estimatedLineTotalMinor: 9500,
      availableStockSnapshot: 400,
    },
  ],
  estimatedSubtotalMinor: 9500,
  estimatedDiscountMinor: 0,
  estimatedDeliveryChargeMinor: 5000,
  estimatedTotalMinor: 14500,
};

function answerWith(options: { quote?: unknown; quoteFails?: unknown } = {}) {
  mockGet.mockImplementation((path: string) => {
    if (path === '/shops') return Promise.resolve({ data: { data: SHOPS } });
    if (path === '/inventory/medicines') return Promise.resolve({ data: { data: [NAPA] } });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  mockPost.mockImplementation((path: string) => {
    if (path === '/orders/quote') {
      if (options.quoteFails) return Promise.reject(options.quoteFails);
      return Promise.resolve({ data: { data: options.quote ?? QUOTE } });
    }
    return Promise.reject(new Error(`unexpected POST ${path}`));
  });
}

async function draw() {
  return render(
    <AskProvider>
      <OrderEntryScreen />
    </AskProvider>,
  );
}

/** Types a brand name and lets the 300ms search debounce elapse. */
async function search(term: string) {
  await fireEvent.changeText(screen.getByLabelText('Add a medicine'), term);
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  answerWith();
});

describe('choosing the customer', () => {
  it('offers the shops the server returned, which are the rep’s own', async () => {
    /*
     * `GET /shops` is territory-scoped server-side to exactly what
     * `POST /orders/submit` will accept, so the picker must show that list and
     * not filter, widen or cache around it. A picker offering a choice the
     * server will reject is worse than no picker.
     */
    await draw();
    await waitFor(() => expect(screen.getByText('Rahman Pharmacy')).toBeTruthy());
    expect(screen.getByText('Karim Medicine Corner')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/shops', { params: { limit: 100 } });
  });

  it('comes back on the next launch, so a visit is not re-typed', async () => {
    await AsyncStorage.setItem('medsupply.orders.customer.v1', 'shop-2');
    await draw();
    await waitFor(() => expect(screen.getByText('Karim Medicine Corner')).toBeTruthy());
    // Past the picker and into the order: the customer line, not a list.
    expect(screen.getByText('Ordering for')).toBeTruthy();
  });

  it('is dropped once the rep may no longer order for them', async () => {
    /*
     * A reassigned territory or a deactivated shop. The remembered id is simply
     * absent from the scoped list, and restoring it anyway would open the screen
     * with a customer selected whom every submission is going to be refused
     * for — discovered only after the whole order had been typed.
     */
    await AsyncStorage.setItem('medsupply.orders.customer.v1', 'shop-99');
    await draw();
    await waitFor(() => expect(screen.getByText('Who is this order for?')).toBeTruthy());
    expect(screen.queryByText('Ordering for')).toBeNull();
  });
});

describe('building the order', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows the server’s price rather than the medicine’s own', async () => {
    /*
     * Napa's catalogue price is ৳120.00 and this customer's price list puts it
     * at ৳95.00. A screen that multiplied the catalogue price would quote a
     * number the invoice then contradicts — with the shopkeeper standing there.
     */
    await AsyncStorage.setItem('medsupply.orders.customer.v1', 'shop-1');
    await draw();
    await waitFor(() => expect(screen.getByText('Ordering for')).toBeTruthy());

    await search('Napa');
    await fireEvent.press(screen.getByLabelText('Napa 500mg'));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith('/orders/quote', {
        shopId: 'shop-1',
        items: [{ medicineId: 'med-1', requestedQuantity: 1 }],
      }),
    );
    expect(screen.getAllByText('৳95.00').length).toBeGreaterThan(0);
    // And the catalogue's own price is nowhere on the order. That is the whole
    // claim: a customer on a price list is quoted the list, not the default.
    expect(screen.queryByText('৳120.00')).toBeNull();
    // The total is the server's too — delivery included, which no amount of
    // multiplying on this screen would have produced.
    expect(screen.getByText('৳145.00')).toBeTruthy();
  });

  it('refuses to place the order with no connection, and says why', async () => {
    /*
     * The whole reason `offlineQueue.ts` is not reused here. A delivery can be
     * captured now and posted later; an order cannot, because its price and its
     * credit check are the server's answers. So the screen must refuse rather
     * than accept something it is unable to price — and must not have called
     * the submission endpoint at all.
     */
    await AsyncStorage.setItem('medsupply.orders.customer.v1', 'shop-1');
    answerWith({ quoteFails: { message: 'Network Error' } });
    await draw();
    await waitFor(() => expect(screen.getByText('Ordering for')).toBeTruthy());

    await search('Napa');
    await fireEvent.press(screen.getByLabelText('Napa 500mg'));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() =>
      expect(
        screen.getByText(
          'No connection. An order needs a live price and a live credit check, so it cannot be taken now and sent later.',
        ),
      ).toBeTruthy(),
    );

    await fireEvent.press(screen.getByLabelText('Place this order'));
    expect(mockPost).not.toHaveBeenCalledWith('/orders/submit', expect.anything());
  });
});
