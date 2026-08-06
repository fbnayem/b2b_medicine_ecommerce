// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithUi } from '../../testing/render';
import { PickOrCreate } from './PickOrCreate';
import { SearchPicker } from './SearchPicker';

/**
 * Making the record that is missing, without leaving the form you are on.
 *
 * The two assertions that matter are the ones that would be easy to get wrong
 * in a way nothing else notices: the button is **absent** for somebody who may
 * not create — an affordance that answers 403 is worse than none — and the new
 * record is **selected** afterwards, because a dialog that closes and leaves
 * the picker empty has made somebody do the work twice.
 */

afterEach(() => cleanup());

const OPTIONS = [
  { value: 'rider-1', label: 'Rana Ahmed' },
  { value: 'rider-2', label: 'Shirin Akter' },
];

describe('choosing one', () => {
  it('offers no way to create when the viewer may not', () => {
    renderWithUi(
      <PickOrCreate
        label="Which rider"
        placeholder="Choose a rider"
        value=""
        onChange={() => {}}
        options={OPTIONS}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Which rider' })).toBeTruthy();
    // Nothing at all, not a disabled button.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the form on screen and selects what was just made', async () => {
    const onChange = vi.fn();
    renderWithUi(
      <PickOrCreate
        label="Which rider"
        placeholder="Choose a rider"
        value=""
        onChange={onChange}
        options={OPTIONS}
        create={{
          label: 'Add a delivery person',
          title: 'Add a delivery person',
          invalidates: ['riders'],
          render: (done) => (
            <button type="button" onClick={() => done('rider-3')}>
              Save
            </button>
          ),
        }}
      />,
    );

    // Not rendered until opened: a form mounted behind a closed dialog would
    // run its own queries, and reopening would show a half-typed record.
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add a delivery person' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('rider-3'));
    // And the dialog is gone, so the form underneath is usable again.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull());
  });
});

describe('searching instead of ending', () => {
  const found = [
    { value: 'med-1', label: 'Napa 500 mg', note: 'NAP-500-10T' },
    { value: 'med-2', label: 'Napa Extra', note: 'NAPX-500-10T' },
  ];

  function mount(onChoose = vi.fn(), term = 'nap') {
    renderWithUi(
      <SearchPicker
        label="Medicine"
        placeholder="Type a brand"
        term={term}
        onTermChange={() => {}}
        options={found}
        emptyLabel="No medicines matched"
        searchingLabel="Searching"
        onChoose={onChoose}
      />,
    );
    return onChoose;
  }

  it('shows nothing until somebody types', () => {
    mount(vi.fn(), '');
    // The list is the *answer* to a term. An always-open list of the first
    // hundred records is the defect this component replaces.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('is a real combobox over a real listbox', () => {
    mount();
    const box = screen.getByRole('combobox', { name: 'Medicine' });
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('moves with the arrow keys and chooses with Enter', () => {
    const onChoose = mount();
    const box = screen.getByRole('combobox', { name: 'Medicine' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledWith('med-2');
  });

  it('says a search found nothing rather than showing an empty box', () => {
    renderWithUi(
      <SearchPicker
        label="Medicine"
        term="zzz"
        onTermChange={() => {}}
        options={[]}
        emptyLabel="No medicines matched"
        searchingLabel="Searching"
        onChoose={() => {}}
      />,
    );
    expect(screen.getByText('No medicines matched')).toBeTruthy();
  });
});
