import test from 'node:test';
import assert from 'node:assert/strict';
import { UserRole } from '@medsupply/shared-types';
import { canPlaceOnBehalf, decideOnBehalf, territoryPermits } from './onBehalfRules';

/**
 * Who may place an order for a shop that is not theirs.
 *
 * Every order route was `SHOP_OWNER`-only, so the volume that actually arrives
 * in this trade had no path in — somebody was signing in as the customer, or
 * typing it up afterwards, and either way the order book could not say who
 * really placed it.
 */

test('a shop owner cannot order for anybody but themselves', () => {
  // Their own orders go through the existing path; this is the *other* path,
  // and letting a customer near it would let one shop order against another.
  assert.equal(canPlaceOnBehalf(UserRole.SHOP_OWNER), false);
  assert.equal(canPlaceOnBehalf(UserRole.STOREKEEPER), false);
  assert.equal(canPlaceOnBehalf(UserRole.DELIVERY_PERSON), false);
});

test('a rep and management can', () => {
  assert.equal(canPlaceOnBehalf(UserRole.SALES), true);
  assert.equal(canPlaceOnBehalf(UserRole.MANAGER), true);
  assert.equal(canPlaceOnBehalf(UserRole.ADMIN), true);
  assert.equal(canPlaceOnBehalf(UserRole.SUPER_ADMIN), true);
});

test('no territories means every territory', () => {
  // Every user in the database has none, and management is not territorial.
  // The restriction has to apply to the people it was written for and to
  // nobody else, or adding it breaks everybody on the day it ships.
  assert.equal(territoryPermits(undefined, 'Dhaka North'), true);
  assert.equal(territoryPermits([], 'Dhaka North'), true);
  assert.equal(territoryPermits([], undefined), true);
});

test('a rep with territories is confined to them, whatever the casing', () => {
  assert.equal(territoryPermits(['Dhaka North'], 'Dhaka North'), true);
  assert.equal(territoryPermits(['Dhaka North', 'Gazipur'], 'gazipur'), true);
  assert.equal(territoryPermits(['Dhaka North'], ' DHAKA NORTH '), true);
  assert.equal(territoryPermits(['Dhaka North'], 'Chattogram'), false);
});

test('a shop with no territory is reachable only by somebody unrestricted', () => {
  // "We do not know where this shop is" must not read as "anybody may sell to
  // it" — that is the direction a mistake here goes wrong.
  assert.equal(territoryPermits(['Dhaka North'], undefined), false);
  assert.equal(territoryPermits(['Dhaka North'], null), false);
  assert.equal(territoryPermits(['Dhaka North'], ''), false);
});

test('the refusal says which of the two rules refused', () => {
  // A rep needs to tell "you cannot do this at all" from "not for that shop",
  // and the audit record should not conflate them either.
  assert.deepEqual(decideOnBehalf({ role: UserRole.SHOP_OWNER }, { territory: 'Dhaka North' }), {
    allowed: false,
    code: 'ROLE_CANNOT_ORDER_ON_BEHALF',
  });
  assert.deepEqual(
    decideOnBehalf({ role: UserRole.SALES, territories: ['Gazipur'] }, { territory: 'Sylhet' }),
    { allowed: false, code: 'SHOP_OUTSIDE_TERRITORY' },
  );
  assert.deepEqual(
    decideOnBehalf({ role: UserRole.SALES, territories: ['Sylhet'] }, { territory: 'Sylhet' }),
    { allowed: true },
  );
});
