import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { OrderStatus, PaymentStatus } from '@medsupply/shared-types';
import { Toaster, toast } from './Toast';
import { StatusPill, statusLabel } from './Status';
import { EmptyState, ErrorState, LoadingState } from './Feedback';
import { LanguageProvider } from '../i18n/useLanguage';

describe('Toaster', () => {
  it('is a live region even before anything has been said', async () => {
    // A live region mounted only once it has content is announced
    // inconsistently: the assistive technology has nothing to observe until it
    // is already too late.
    await render(<Toaster />);
    expect(screen.getByTestId('toaster').props.accessibilityLiveRegion).toBe('polite');
  });

  it('shows what was raised, and clears when tapped', async () => {
    await render(<Toaster />);
    await act(async () => toast.success('Payment recorded'));
    await waitFor(() => expect(screen.getByText('Payment recorded')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Payment recorded' }));
    expect(screen.queryByText('Payment recorded')).toBeNull();
  });

  it('carries the message as its accessible name, not just as pixels', async () => {
    await render(<Toaster />);
    await act(async () => toast.error('That payment could not be reversed'));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'That payment could not be reversed' }),
      ).toBeTruthy(),
    );
  });
});

describe('StatusPill', () => {
  it('says the catalogue’s words, not the enum', async () => {
    // `READY FOR DELIVERY` shouting at a storekeeper is what this replaced.
    await render(<StatusPill kind="order" status={OrderStatus.READY_FOR_DELIVERY} />);
    expect(screen.getByText('Ready for delivery')).toBeTruthy();
  });

  it('says them in Bangla when that is the language', async () => {
    await render(
      <LanguageProvider tenantDefault="bn">
        <StatusPill kind="payment" status={PaymentStatus.POSTED} />
      </LanguageProvider>,
    );
    // The pill and the filter dropdown read the same catalogue entry now, so
    // they cannot disagree in one language and agree in the other.
    await waitFor(() => expect(screen.queryByText('Posted')).toBeNull());
  });

  it('shows an unknown status rather than an empty pill', async () => {
    // Can only come from a server newer than this build. Visible and visibly
    // unpolished beats blank.
    const t = (path: string) => path;
    expect(statusLabel(t, 'order', 'SOMETHING_NEW')).toBe('something new');
  });
});

describe('the three states', () => {
  it('announces a wait rather than only spinning', async () => {
    await render(<LoadingState label="Loading your orders" />);
    expect(screen.getByRole('progressbar', { name: 'Loading your orders' })).toBeTruthy();
  });

  it('gives a failure something to press', async () => {
    // Every screen said "pull down to retry", which is discoverable to the
    // person who wrote it and to nobody wearing gloves in a cold store.
    const onRetry = jest.fn();
    await render(<ErrorState message="That did not load." reference="REQ-1" onRetry={onRetry} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/REQ-1/)).toBeTruthy();
  });

  it('raises a failure as an alert', async () => {
    await render(<ErrorState message="That did not load." />);
    expect(screen.getByRole('alert')).toHaveTextContent(/That did not load\./);
  });

  it('lets an empty list offer the way out of being empty', async () => {
    const onPress = jest.fn();
    await render(
      <EmptyState
        title="No packages ready"
        description="Nothing has been packed yet today."
        action={{ label: 'Refresh', onPress }}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
