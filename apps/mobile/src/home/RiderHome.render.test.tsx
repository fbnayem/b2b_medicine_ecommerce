import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { RiderHome } from './RiderHome';

/**
 * A rider's home screen, rendered.
 *
 * `round.ts` proves the arithmetic; this proves the screen shows it. The two
 * claims worth a renderer are the ones that fail silently:
 *
 *   - the **next stop** is on screen with somewhere to ring and somewhere to
 *     drive, because a rider's first two actions were two screens away;
 *   - a **zero is never rendered**, which is the rule `waiting.ts` holds for
 *     staff and the reason anything here is worth a tap.
 */

/*
 * `useFocusEffect` deferred to `useEffect`, not called during render.
 *
 * The obvious mock — `(effect) => effect()` — runs the load during the render
 * phase, so its state updates land outside `act` and React tears the tree down
 * mid-commit. The failure it produces says "Element type is invalid… check the
 * render method of RiderHome", which points at a component that is perfectly
 * fine. Behaving like the real hook, which fires after commit, is both accurate
 * and the thing that makes the suite readable.
 */
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));

const mockGet = jest.fn();
jest.mock('../api/client', () => ({ apiClient: { get: (...a: unknown[]) => mockGet(...a) } }));

const mockTrips = jest.fn();
jest.mock('../delivery/trips', () => ({ fetchMyTrips: () => mockTrips() }));

const mockCollections = jest.fn();
jest.mock('../finance/api', () => ({ getMyCollections: () => mockCollections() }));

const mockQueue = jest.fn();
jest.mock('../delivery/offlineQueue', () => ({
  loadDeliveryQueue: () => mockQueue(),
  loadCachedDeliveries: () => Promise.resolve([]),
}));

const stop = (sequence: number, id: string, status: string, name: string) => ({
  _id: `stop-${sequence}`,
  sequence,
  delivery: {
    _id: id,
    reference: `DEL-${id}`,
    status,
    shopId: { _id: `shop-${id}`, reference: `SHP-${id}`, name },
    addressSnapshot: { line1: '14/B Bangla Motor', city: 'Dhaka' },
    contactSnapshot: { name, phone: '01711000111' },
  },
});

function arrange(options: { carryingMinor?: number; unsent?: number } = {}) {
  mockTrips.mockResolvedValue([
    {
      _id: 'trip-1',
      reference: 'TRP-2026-000001',
      status: 'IN_PROGRESS',
      stops: [
        stop(1, 'a', 'DELIVERED', 'Shafin Pharmacy'),
        stop(2, 'b', 'OUT_FOR_DELIVERY', 'Noor Medical Hall'),
        stop(3, 'c', 'ASSIGNED', 'Bismillah Pharmacy'),
      ],
    },
  ]);
  mockGet.mockResolvedValue({ data: { data: [] } });
  mockCollections.mockResolvedValue({
    summary: { todayCollectedMinor: 0, pendingHandoverMinor: options.carryingMinor ?? 0 },
  });
  mockQueue.mockResolvedValue(Array.from({ length: options.unsent ?? 0 }, (_, i) => ({ id: i })));
}

describe('the screen a rider opens', () => {
  beforeEach(() => jest.clearAllMocks());

  it('leads with the next stop, and where it is on the round', async () => {
    arrange();
    render(<RiderHome menu={<Text>Menu</Text>} />);

    // The first stop that is not finished, not the first stop.
    await waitFor(() => expect(screen.getByText('Noor Medical Hall')).toBeTruthy());
    expect(screen.getByText('14/B Bangla Motor, Dhaka')).toBeTruthy();
    expect(screen.getByText('Stop 2 of 3')).toBeTruthy();

    // The two things a rider does before driving anywhere.
    expect(screen.getByText('Call the shop')).toBeTruthy();
    expect(screen.getByText('Open the map')).toBeTruthy();
  });

  it('shows the cash being carried, as money rather than as a count', async () => {
    arrange({ carryingMinor: 1_250_000 });
    render(<RiderHome menu={<Text>Menu</Text>} />);

    await waitFor(() => expect(screen.getByText('৳12,500.00')).toBeTruthy());
    expect(screen.getByText('collected and not handed in')).toBeTruthy();
  });

  it('says nothing at all about the things that are zero', async () => {
    arrange({ carryingMinor: 0, unsent: 0 });
    render(<RiderHome menu={<Text>Menu</Text>} />);

    await waitFor(() => expect(screen.getByText('Noor Medical Hall')).toBeTruthy());
    /*
     * A home screen listing "0 not sent yet" teaches somebody to stop reading
     * it, and the next number they skip is a real one. Two stops remain, so
     * that line is present; the cash and the unsent queue are absent entirely
     * rather than shown as noughts.
     */
    expect(screen.getByText('2 stops left today')).toBeTruthy();
    expect(screen.queryByText('collected and not handed in')).toBeNull();
    expect(screen.queryByText(/not sent yet/)).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('says the round is done rather than pointing at a finished stop', async () => {
    arrange();
    mockTrips.mockResolvedValue([
      {
        _id: 'trip-1',
        reference: 'TRP-2026-000001',
        status: 'IN_PROGRESS',
        stops: [stop(1, 'a', 'DELIVERED', 'Shafin Pharmacy')],
      },
    ]);
    render(<RiderHome menu={<Text>Menu</Text>} />);

    await waitFor(() => expect(screen.getByText('Every stop is done')).toBeTruthy());
    expect(screen.queryByText('Shafin Pharmacy')).toBeNull();
  });

  it('still shows the round when the collections request fails', async () => {
    // A rider is often on one bar of signal. A home screen that shows nothing
    // because one of four requests timed out appears broken exactly when it is
    // needed most.
    arrange();
    mockCollections.mockRejectedValue(new Error('no signal'));
    render(<RiderHome menu={<Text>Menu</Text>} />);

    await waitFor(() => expect(screen.getByText('Noor Medical Hall')).toBeTruthy());
  });
});
