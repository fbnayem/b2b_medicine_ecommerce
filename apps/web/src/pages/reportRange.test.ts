import { afterEach, describe, expect, it, vi } from 'vitest';
import { rollingRange } from './reportRange';

/**
 * The window the home screen's charts ask for.
 *
 * This exists because of a defect that only showed itself on certain days of
 * the month. The charts took the server's default range, which is
 * **month-to-date**, so the sales line was drawn from however much of the month
 * had happened — three days of it on the 3rd, and **a single point on the
 * 1st**. A month of seeded trading rendered as a flat line, and nothing about
 * the screen said the period was the reason.
 *
 * So the assertions below are mostly about month boundaries, because that is
 * where the old behaviour and the new one differ most.
 */

afterEach(() => {
  vi.useRealTimers();
});

/** Freezes the clock at an instant, given as UTC. */
function at(instant: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(instant));
}

describe('rollingRange', () => {
  it('reaches back into the previous month on the first of a month', () => {
    at('2026-08-01T04:00:00.000Z');
    // Month-to-date here is `2026-08-01` to `2026-08-01`: one day, one point,
    // no line. This is the whole reason the helper exists.
    expect(rollingRange(30)).toEqual({ from: '2026-07-03', to: '2026-08-01' });
  });

  it('counts inclusively, so 30 is today and the 29 before it', () => {
    at('2026-08-06T04:00:00.000Z');
    const { from, to } = rollingRange(30);
    expect(to).toBe('2026-08-06');
    expect(from).toBe('2026-07-08');
    // Stated as arithmetic as well as as a date, so an off-by-one in either the
    // subtraction or the expectation above cannot pass unnoticed.
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    expect(days).toBe(29);
  });

  it('crosses a year boundary', () => {
    at('2027-01-05T04:00:00.000Z');
    expect(rollingRange(30)).toEqual({ from: '2026-12-07', to: '2027-01-05' });
  });

  it('handles February in a leap year', () => {
    at('2028-03-01T04:00:00.000Z');
    // 2028 is a leap year, so this must land on 1 February and not 2 February.
    expect(rollingRange(30)).toEqual({ from: '2028-02-01', to: '2028-03-01' });
  });

  it('reads the date on the business calendar, not the browser’s', () => {
    /*
     * 20:00 UTC is already the next day in Dhaka (UTC+6), and a report opened
     * late at night must default to the day the business is having rather than
     * the day Greenwich is having.
     */
    at('2026-07-31T20:00:00.000Z');
    expect(rollingRange(30).to).toBe('2026-08-01');
  });

  it('gives a single day for a window of one', () => {
    at('2026-08-06T04:00:00.000Z');
    expect(rollingRange(1)).toEqual({ from: '2026-08-06', to: '2026-08-06' });
  });
});
