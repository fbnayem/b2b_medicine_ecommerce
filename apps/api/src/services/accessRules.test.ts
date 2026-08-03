import assert from 'node:assert/strict';
import test from 'node:test';
import { UserRole } from '@medsupply/shared-types';
import { CREDIT_OVERRIDE_ROLES } from './approvalService';
import { CANCELLABLE_STATUSES, CANCELLATION_DECIDERS } from './cancellationService';
import { OrderStatus } from '@medsupply/shared-types';

/**
 * The three decisions phase 4 settled, as assertions rather than as prose in a
 * document that another document contradicts.
 */

test('a credit override is an administrator decision', () => {
  // Two documents disagreed and the code checked nobody: PHASE_STATUS.md said
  // Admin-only, PERMISSIONS.md said Managers too, and `approvalService` applied
  // no role check at all — any approver could extend unsecured credit past an
  // agreed limit with a five-character reason.
  assert.deepEqual(
    [...CREDIT_OVERRIDE_ROLES].sort(),
    [UserRole.ADMIN, UserRole.SUPER_ADMIN].sort(),
  );
  assert.ok(!CREDIT_OVERRIDE_ROLES.includes(UserRole.MANAGER));
  assert.ok(!CREDIT_OVERRIDE_ROLES.includes(UserRole.SHOP_OWNER));
});

test('a cancellation is decided by management, never by the shop that asked', () => {
  assert.ok(!CANCELLATION_DECIDERS.includes(UserRole.SHOP_OWNER));
  assert.ok(!CANCELLATION_DECIDERS.includes(UserRole.STOREKEEPER));
  assert.ok(!CANCELLATION_DECIDERS.includes(UserRole.DELIVERY_PERSON));
  assert.ok(CANCELLATION_DECIDERS.includes(UserRole.MANAGER));
});

test('cancellation stops where an invoice and a stock movement begin', () => {
  // Past packing an invoice exists and goods have left the shelf. Cancelling
  // there would leave an invoice with no order behind it; the instrument for
  // that situation is a return, which credits the invoice and receives the
  // goods back.
  for (const status of [
    OrderStatus.PACKED,
    OrderStatus.INVOICE_GENERATED,
    OrderStatus.READY_FOR_DELIVERY,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ]) {
    assert.ok(!CANCELLABLE_STATUSES.includes(status), `${status} must not be cancellable`);
  }
  for (const status of [
    OrderStatus.SUBMITTED,
    OrderStatus.UNDER_REVIEW,
    OrderStatus.ON_HOLD,
    OrderStatus.APPROVED,
  ]) {
    assert.ok(CANCELLABLE_STATUSES.includes(status), `${status} must be cancellable`);
  }
});
