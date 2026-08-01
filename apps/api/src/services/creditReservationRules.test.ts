import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeExposure, calculateCreditConsumption } from './creditReservationService';

test('credit consumption releases unused reservation exposure', () => {
  assert.deepEqual(calculateCreditConsumption(1_000, 750), {
    consumedExposureMinor: 750,
    releasedExposureMinor: 250,
    additionalExposureMinor: 0,
  });
});

test('credit consumption identifies additional invoice exposure', () => {
  assert.deepEqual(calculateCreditConsumption(1_000, 1_150), {
    consumedExposureMinor: 1_150,
    releasedExposureMinor: 0,
    additionalExposureMinor: 150,
  });
});

test('a zero-value final invoice releases the complete reservation', () => {
  assert.deepEqual(calculateCreditConsumption(1_000, 0), {
    consumedExposureMinor: 0,
    releasedExposureMinor: 1_000,
    additionalExposureMinor: 0,
  });
});

test('credit exposure rejects unsafe, negative, and unexpectedly zero amounts', () => {
  assert.throws(() => assertSafeExposure(Number.MAX_SAFE_INTEGER + 1, 'Exposure'), /safe integer/);
  assert.throws(() => assertSafeExposure(-1, 'Exposure'), /safe integer/);
  assert.throws(() => assertSafeExposure(0, 'Exposure', false), /safe integer/);
});
