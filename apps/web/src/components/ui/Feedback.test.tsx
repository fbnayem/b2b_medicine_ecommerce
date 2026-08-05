// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithUi } from '../../testing/render';
import { ErrorState, FormNotice, LoadingState } from './Feedback';

/**
 * The two facts these primitives are responsible for keeping apart.
 *
 * A form that is not finished being filled in is not a malfunction, and until
 * this phase four hand-rolled forms said it was — the same red card, the same
 * "Something went wrong", for a missing field and for an unreachable database.
 */

describe('FormNotice', () => {
  it('is not the error card', () => {
    renderWithUi(<FormNotice problems={['Add at least one stop.']} focusKey={1} />);

    expect(screen.getByTestId('form-notice')).toBeTruthy();
    // The distinction the end-to-end screen sweep depends on: a form waiting to
    // be filled in must not register as a screen that failed to load.
    expect(screen.queryByTestId('error-state')).toBeNull();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.getByText('This is not ready to be saved yet')).toBeTruthy();
  });

  it('lists the problems separately rather than as one sentence', () => {
    renderWithUi(
      <FormNotice
        problems={['Choose which rider is making this round.', 'Add at least one stop.']}
        focusKey={1}
      />,
    );

    // Somebody who has already chosen a rider needs to see which of the three
    // requirements is the one they have not met.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders nothing when there is nothing to say', () => {
    renderWithUi(<FormNotice problems={[]} focusKey={0} />);
    // Not an empty container: the test wrapper mounts a `Toaster` too.
    expect(screen.queryByTestId('form-notice')).toBeNull();
  });

  it('takes the cursor to the control a problem is about', () => {
    renderWithUi(
      <>
        <FormNotice problems={[{ message: 'Choose a rider.', focus: 'rider' }]} focusKey={1} />
        <input id="rider" aria-label="Rider" />
      </>,
    );

    // jsdom computes no layout, so `scrollIntoView` is not implemented on it.
    const target = document.getElementById('rider')!;
    target.scrollIntoView = vi.fn();

    fireEvent.click(screen.getByRole('button', { name: 'Take me there' }));
    expect(document.activeElement).toBe(target);
  });

  it('moves focus to itself on a submit attempt', async () => {
    renderWithUi(<FormNotice problems={['Add at least one stop.']} focusKey={1} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('form-notice')));
  });
});

describe('the feedback primitives read from the catalogue', () => {
  /*
   * These assert English because the tests mount in English. The point is not
   * the words — it is that they now arrive through `useLanguage` rather than as
   * literals, which is what `src/testing/uiStrings.test.ts` enforces and what
   * makes the Bangla toggle apply to a failure at all.
   */
  it('says what went wrong, offers a retry, and quotes the reference', () => {
    renderWithUi(
      <ErrorState
        message="The rounds could not be loaded."
        reference="abc-123"
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByText(/Quote this reference if you contact support/)).toBeTruthy();
    expect(screen.getByText('abc-123')).toBeTruthy();
  });

  it('announces a wait', () => {
    renderWithUi(<LoadingState />);
    expect(screen.getByRole('status').textContent).toContain('Loading');
  });
});
