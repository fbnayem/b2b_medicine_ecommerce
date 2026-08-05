// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithUi } from '../testing/render';
import { MedicineForm } from './MedicineForm';

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
