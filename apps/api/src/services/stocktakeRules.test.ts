import test from 'node:test';
import assert from 'node:assert/strict';
import { varianceSummary } from './stocktakeService';

/**
 * The variance sheet.
 *
 * The distinction every one of these turns on is **uncounted is not zero**. A
 * line nobody reached and a line counted as empty are different findings, and
 * conflating them would mean a session that missed an aisle reports a
 * catastrophic shortfall — and, worse, posts one.
 */

const line = (systemQuantity: number, countedQuantity: number | null) => ({
  systemQuantity,
  countedQuantity,
});

test('an untouched sheet has counted nothing and found no variance', () => {
  const summary = varianceSummary([line(10, null), line(5, null)]);
  assert.deepEqual(summary, {
    linesTotal: 2,
    linesCounted: 0,
    linesUncounted: 2,
    linesDiffering: 0,
    unitsOver: 0,
    unitsShort: 0,
  });
});

test('a line counted as empty is a finding, not a gap', () => {
  // Zero is a real answer — "there are none there" is precisely what a count
  // exists to discover — and it must not be filed alongside "nobody looked".
  const summary = varianceSummary([line(12, 0)]);
  assert.equal(summary.linesCounted, 1);
  assert.equal(summary.linesUncounted, 0);
  assert.equal(summary.linesDiffering, 1);
  assert.equal(summary.unitsShort, 12);
});

test('a line nobody reached contributes nothing to the shortfall', () => {
  // The failure this prevents: treating `null` as zero would report 12 units
  // short for an aisle that is fully stocked and simply was not visited.
  const summary = varianceSummary([line(12, null)]);
  assert.equal(summary.linesDiffering, 0);
  assert.equal(summary.unitsShort, 0);
});

test('overs and shorts are reported separately, never netted off', () => {
  // Six missing here and six extra there is two problems, not zero problems.
  // A net figure of zero would close a count that should have been questioned.
  const summary = varianceSummary([line(100, 94), line(40, 46)]);
  assert.equal(summary.linesDiffering, 2);
  assert.equal(summary.unitsShort, 6);
  assert.equal(summary.unitsOver, 6);
});

test('a line counted exactly right is counted but not differing', () => {
  const summary = varianceSummary([line(30, 30)]);
  assert.equal(summary.linesCounted, 1);
  assert.equal(summary.linesDiffering, 0);
  assert.equal(summary.unitsOver, 0);
  assert.equal(summary.unitsShort, 0);
});

test('an absent countedQuantity reads the same as an explicit null', () => {
  // Mongoose hands back `undefined` for an unset path in some read paths and
  // `null` in others; both mean "nobody has counted it".
  const summary = varianceSummary([{ systemQuantity: 9 }, line(9, null)]);
  assert.equal(summary.linesUncounted, 2);
  assert.equal(summary.unitsShort, 0);
});
