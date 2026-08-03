import assert from 'node:assert/strict';
import test from 'node:test';
import { DeliveryStatus, UserRole } from '@medsupply/shared-types';
import {
  DELIVERY_ACTION_ROUTES,
  deliveryPolicy,
  deliveryTransitionPolicies,
  evaluateDeliveryTransition,
} from './deliveryRules';
import { routeKey, routeTable } from './routeTable';

/**
 * These tests run the state machine rather than describing it.
 *
 * The previous version asserted that each policy had a non-empty `from`, a
 * non-empty `roles` and an audit event beginning with `DELIVERY_` — all true of
 * a table full of wrong states. Nothing in it would have failed if `COMPLETE`
 * had been reachable from `ASSIGNED`, letting a rider mark goods delivered
 * before collecting them. What follows exercises every action against every
 * status and every role, so exactly the legal moves are legal.
 */

const ALL_STATUSES = Object.values(DeliveryStatus);
const ALL_ROLES = Object.values(UserRole);

test('each action is permitted from exactly the states its policy names', () => {
  for (const policy of deliveryTransitionPolicies) {
    const role = policy.roles[0];
    for (const status of ALL_STATUSES) {
      const verdict = evaluateDeliveryTransition(policy.action, status, role);
      const shouldAllow = policy.from.includes(status);
      assert.equal(
        verdict.allowed,
        shouldAllow,
        `${policy.action} from ${status} as ${role} should be ${shouldAllow ? 'allowed' : 'refused'}`,
      );
      if (verdict.allowed) assert.equal(verdict.to, policy.to);
      else if (!shouldAllow) assert.equal(verdict.reason, 'WRONG_STATE');
    }
  }
});

test('each action is permitted to exactly the roles its policy names', () => {
  for (const policy of deliveryTransitionPolicies) {
    const legalState = policy.from[0];
    for (const role of ALL_ROLES) {
      const verdict = evaluateDeliveryTransition(policy.action, legalState, role);
      const shouldAllow = policy.roles.includes(role);
      assert.equal(
        verdict.allowed,
        shouldAllow,
        `${policy.action} as ${role} should be ${shouldAllow ? 'allowed' : 'refused'}`,
      );
      if (!verdict.allowed && !shouldAllow) assert.equal(verdict.reason, 'WRONG_ROLE');
    }
  }
});

test('a rider cannot confirm delivery of goods they have not collected', () => {
  // The most consequential illegal move: proof of delivery stages the
  // collection for posting, so reaching DELIVERED early would put money in the
  // ledger for goods still on the shelf.
  for (const before of [
    DeliveryStatus.READY_FOR_ASSIGNMENT,
    DeliveryStatus.ASSIGNED,
    DeliveryStatus.HANDED_OVER,
    DeliveryStatus.PICKED_UP,
    DeliveryStatus.OUT_FOR_DELIVERY,
  ]) {
    const verdict = evaluateDeliveryTransition('COMPLETE', before, UserRole.DELIVERY_PERSON);
    assert.equal(verdict.allowed, false, `COMPLETE must be refused from ${before}`);
  }
  assert.equal(
    evaluateDeliveryTransition('COMPLETE', DeliveryStatus.ARRIVED, UserRole.DELIVERY_PERSON)
      .allowed,
    true,
  );
});

test('custody changes hands only between the two roles that hold it', () => {
  // Handover is storekeeper-only and pickup is rider-only. If either accepted
  // the other, one person could move a package through custody alone.
  assert.equal(
    evaluateDeliveryTransition('HANDOVER', DeliveryStatus.ASSIGNED, UserRole.DELIVERY_PERSON)
      .allowed,
    false,
  );
  assert.equal(
    evaluateDeliveryTransition('PICKUP', DeliveryStatus.HANDED_OVER, UserRole.STOREKEEPER).allowed,
    false,
  );
  assert.equal(
    evaluateDeliveryTransition('RECEIVE_RETURN', DeliveryStatus.RETURNING, UserRole.DELIVERY_PERSON)
      .allowed,
    false,
  );
});

test('an unknown action is refused rather than defaulting to permitted', () => {
  const verdict = evaluateDeliveryTransition(
    'DELETE',
    DeliveryStatus.ARRIVED,
    UserRole.SUPER_ADMIN,
  );
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.allowed === false && verdict.reason, 'UNKNOWN_ACTION');
});

test('every declared transition is reachable through a route that exists', () => {
  const served = new Set(routeTable().map(routeKey));
  const unreachable: string[] = [];

  for (const policy of deliveryTransitionPolicies) {
    const route = DELIVERY_ACTION_ROUTES[policy.action];
    if (!route) unreachable.push(`${policy.action} has no endpoint mapped`);
    else if (!served.has(route)) unreachable.push(`${policy.action} maps to ${route}, not served`);
  }
  for (const action of Object.keys(DELIVERY_ACTION_ROUTES)) {
    if (!deliveryPolicy(action)) unreachable.push(`${action} is mapped but has no policy`);
  }

  assert.deepEqual(
    unreachable,
    [],
    'The delivery state machine and the delivery routes disagree:\n' +
      unreachable.map((line) => `  ${line}`).join('\n'),
  );
});
