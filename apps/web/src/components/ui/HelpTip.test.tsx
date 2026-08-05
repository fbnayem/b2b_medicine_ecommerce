// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithUi } from '../../testing/render';
import { Field, Input } from './Field';
import { HelpTip } from './HelpTip';

/**
 * The behaviours that made this a Popover rather than a Tooltip.
 *
 * The first assertion is the load-bearing one: **the explanation must not be in
 * the document until it is asked for.** A component that renders its body
 * eagerly and merely hides it with CSS would pass every other test here while
 * defeating the entire point — the whole reason for a disclosure is that the
 * form stays readable until somebody wants more.
 */

describe('HelpTip', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  const mount = () =>
    renderWithUi(<HelpTip label="About Sold as" body="An order for 5 means 5 of this." />);

  it('says nothing until it is asked', () => {
    mount();
    // The self-proof. An eager render fails here and nowhere else.
    expect(screen.queryByText('An order for 5 means 5 of this.')).toBeNull();
    expect(screen.getByRole('button', { name: 'About Sold as' })).toBeTruthy();
  });

  it('opens on hover, which is what was asked for', () => {
    mount();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'About Sold as' }));
    expect(screen.getByText('An order for 5 means 5 of this.')).toBeTruthy();
  });

  it('opens on a click, so it works on a phone', () => {
    mount();
    const trigger = screen.getByRole('button', { name: 'About Sold as' });
    // A tap: the pointer is touch, so the hover handlers must stand aside and
    // let the click do the work. Without the guard the synthetic mouseenter
    // opens it and the click immediately closes it again.
    fireEvent.pointerDown(trigger, { pointerType: 'touch' });
    fireEvent.mouseEnter(trigger);
    fireEvent.click(trigger);
    expect(screen.getByText('An order for 5 means 5 of this.')).toBeTruthy();
  });

  it('stays open while the pointer travels onto it', () => {
    mount();
    const trigger = screen.getByRole('button', { name: 'About Sold as' });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger);
    // Reaching the panel before the close lands. WCAG 2.1 SC 1.4.13 calls this
    // "hoverable" and it is the reason for the delay rather than an immediate
    // close.
    fireEvent.mouseEnter(screen.getByText('An order for 5 means 5 of this.'));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText('An order for 5 means 5 of this.')).toBeTruthy();
  });

  it('closes when the pointer leaves and does not come back', () => {
    mount();
    const trigger = screen.getByRole('button', { name: 'About Sold as' });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseLeave(trigger);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText('An order for 5 means 5 of this.')).toBeNull();
  });

  it('can be dismissed from the keyboard without moving the pointer', () => {
    mount();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'About Sold as' }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByText('An order for 5 means 5 of this.')).toBeNull();
  });

  it('does not steal the label from the control it explains', () => {
    renderWithUi(
      <Field label="Sold as" help={<HelpTip label="About Sold as" body="Box, strip or bottle." />}>
        <Input />
      </Field>,
    );

    // The icon is a sibling of the label, not inside it — otherwise pressing it
    // would also focus the input, and the accessible name of the field would
    // pick up the icon's own.
    expect(screen.getByLabelText('Sold as')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'About Sold as' })).toBeTruthy();
  });
});
