import assert from 'node:assert/strict';
import test from 'node:test';
import { DeliveryStatus, UserRole } from '@medsupply/shared-types';
import { deliveryPolicy, deliveryTransitionPolicies } from './deliveryRules';

test('every delivery transition declares enforcement and audit metadata', () => {
  assert.ok(deliveryTransitionPolicies.length >= 9);
  for (const policy of deliveryTransitionPolicies) {
    assert.ok(policy.from.length);
    assert.ok(policy.roles.length);
    assert.ok(policy.auditEvent.startsWith('DELIVERY_'));
    assert.ok(policy.sideEffects);
  }
});

test('handover and completion remain role- and state-controlled', () => {
  const handover = deliveryPolicy('HANDOVER');
  assert.deepEqual(handover?.from, [DeliveryStatus.ASSIGNED]);
  assert.deepEqual(handover?.roles, [UserRole.STOREKEEPER]);
  const complete = deliveryPolicy('COMPLETE');
  assert.deepEqual(complete?.from, [DeliveryStatus.ARRIVED]);
  assert.deepEqual(complete?.roles, [UserRole.DELIVERY_PERSON]);
  assert.ok(complete?.requiredData.includes('configured proof'));
});
