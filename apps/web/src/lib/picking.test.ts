import { describe, expect, it } from 'vitest';
import { applyScan, matchScan, parseScan, type ScannableLine } from './picking';

/**
 * The scan is the picker's whole interaction with this screen, so the rules
 * about what it means are the rules about what leaves the warehouse.
 */

const LINES: ScannableLine[] = [
  { id: 'a', batchNumber: 'NAP-2026-01', brandName: 'Napa 500', allocated: 12 },
  { id: 'b', batchNumber: 'NAP-2026-02', brandName: 'Napa 500', allocated: 6 },
  { id: 'c', batchNumber: 'ACE-2026-11', brandName: 'Ace 500', allocated: 20 },
];

describe('reading a scan', () => {
  it('treats a bare code as one carton', () => {
    expect(parseScan('NAP-2026-01')).toEqual({ code: 'NAP-2026-01', quantity: 1 });
  });

  it('accepts a multiplier, so an outer is not scanned twelve times', () => {
    expect(parseScan('NAP-2026-01 x 12')).toEqual({ code: 'NAP-2026-01', quantity: 12 });
    expect(parseScan('NAP-2026-01*12')).toEqual({ code: 'NAP-2026-01', quantity: 12 });
  });

  it('reads nothing from nothing, and nothing from a zero', () => {
    expect(parseScan('   ')).toBeNull();
    // `ABC x 0` is a typo, not an instruction to record nothing.
    expect(parseScan('NAP-2026-01 x 0')).toBeNull();
  });
});

describe('matching a scan to a line', () => {
  it('matches the batch number printed on the carton', () => {
    expect(matchScan(LINES, 'NAP-2026-02')).toEqual({ line: LINES[1] });
  });

  it('folds case and spacing, because a scanner and a keyboard differ', () => {
    expect(matchScan(LINES, ' nap-2026-02 ')).toEqual({ line: LINES[1] });
  });

  it('matches a brand prefix when only one line can be meant', () => {
    expect(matchScan(LINES, 'ace')).toEqual({ line: LINES[2] });
  });

  it('refuses a brand that names two batches rather than guessing', () => {
    /*
     * The defect this rule exists to prevent. Two batches of one brand is the
     * ordinary case here, and picking the first would attach the wrong batch
     * number to the invoice — which is the identifier a recall follows.
     */
    expect(matchScan(LINES, 'napa')).toEqual({ error: 'AMBIGUOUS' });
  });

  it('says nothing rather than something when it does not know', () => {
    expect(matchScan(LINES, 'XXX-9999')).toEqual({ error: 'NOT_FOUND' });
    expect(matchScan(LINES, '')).toEqual({ error: 'NOT_FOUND' });
  });
});

describe('counting up', () => {
  it('adds what was scanned', () => {
    expect(applyScan(3, 1, 12)).toEqual({ counted: 4, capped: false });
    expect(applyScan(0, 12, 12)).toEqual({ counted: 12, capped: false });
  });

  it('holds at the allocation and says so', () => {
    // A thirteenth scan of a twelve-unit line is a scanning mistake, and
    // stopping the count dead in the middle of an aisle is worse than capping.
    expect(applyScan(12, 1, 12)).toEqual({ counted: 12, capped: true });
    expect(applyScan(10, 5, 12)).toEqual({ counted: 12, capped: true });
  });
});
