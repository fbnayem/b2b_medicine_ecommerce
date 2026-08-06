import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_DELIVERY_ADDRESSES, hasSoleDefault, soleDefaultIndex } from './shopAddressRules';

/**
 * The invariant, stated as the cases that used to break it.
 *
 * Each of these is a shape a shop document could genuinely hold before this
 * rule existed, because three separate writers touched the array — the seed
 * script, the admin patch form, and now the shop owner's own screen — and none
 * of them agreed on whose job the default was.
 */

const list = (...defaults: boolean[]) => defaults.map((isDefault) => ({ isDefault }));

test('a list with nothing marked gets its first address', () => {
  // The state the seed script leaves behind when the `isDefault` flag is
  // omitted, which is most of them. The checkout screen coped by taking
  // element zero and calling it the default, which is the same answer arrived
  // at by accident rather than by rule.
  assert.equal(soleDefaultIndex(list(false, false, false)), 0);
});

test('a list with two marked keeps only the first', () => {
  /*
   * Reachable today: `PATCH /shops/{id}` takes the whole array, so an admin
   * ticking a second address without unticking the first stores two. "Where
   * does this order go?" then has two answers, and which one wins depends on
   * document order — a fact nobody can see from any screen.
   */
  assert.equal(soleDefaultIndex(list(true, true)), 0);
});

test('what the caller just asked for wins over what is already marked', () => {
  assert.equal(soleDefaultIndex(list(true, false, false), 2), 2);
});

test('an index outside the list is ignored rather than obeyed', () => {
  // A stale id from a screen opened before another device deleted an address.
  // Falling back to the marked one beats writing `isDefault` onto nothing and
  // leaving the shop with no default at all.
  assert.equal(soleDefaultIndex(list(false, true), 7), 1);
  assert.equal(soleDefaultIndex(list(false, true), -3), 1);
});

test('an empty list has no default, and says so', () => {
  /*
   * Not zero. A self-registered pharmacy has no address until they add one,
   * and `-1` is the difference between "none yet" and "the first one" — which
   * a caller writing `addresses[index].isDefault = true` needs to be able to
   * tell apart.
   */
  assert.equal(soleDefaultIndex([]), -1);
});

test('removing the marked address promotes its neighbour', () => {
  // The delete path: the survivors are re-examined and one of them takes over,
  // so a shop can never reach the state where an order has nowhere to go by
  // default while addresses exist.
  const remaining = list(false, false);
  assert.equal(soleDefaultIndex(remaining), 0);
});

test('the invariant check disagrees with a list that breaks it', () => {
  /*
   * The self-proof. `hasSoleDefault` is asserted on after every write in the
   * integration tests, so a version of it that returned `true` unconditionally
   * would make those assertions vacuous.
   */
  assert.equal(hasSoleDefault(list(true, false)), true);
  assert.equal(hasSoleDefault(list(true, true)), false);
  assert.equal(hasSoleDefault(list(false, false)), false);
  assert.equal(hasSoleDefault([]), true, 'no addresses is not a broken list');
});

test('the ceiling is a number somebody could actually reach', () => {
  // Low enough to keep the document small, high enough that refusing the next
  // one is a real business limit rather than a bug report.
  assert.ok(MAX_DELIVERY_ADDRESSES >= 5 && MAX_DELIVERY_ADDRESSES <= 50);
});
