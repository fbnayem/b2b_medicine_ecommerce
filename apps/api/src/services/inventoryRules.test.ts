import assert from 'node:assert/strict';
import test from 'node:test';
import { CreateMedicineSchema, ReceiveStockSchema } from '@medsupply/validation';
import { MedicineClassification } from '@medsupply/shared-types';
import { availableAfterAdjustment, planFefoAllocation } from './inventoryRules';

test('medicine validation rejects inverted order limits and fractional money', () => {
  const result = CreateMedicineSchema.safeParse({
    sku: 'abc-1',
    brandName: 'Napa',
    genericName: 'Paracetamol',
    manufacturer: 'Example Pharma',
    strength: '500 mg',
    dosageForm: 'Tablet',
    packSize: '10 tablets',
    unit: 'box',
    category: 'Analgesic',
    costPriceMinor: 10.5,
    defaultSellingPriceMinor: 2000,
    minimumOrderQuantity: 10,
    maximumOrderQuantity: 5,
    classification: MedicineClassification.OTC,
  });
  assert.equal(result.success, false);
});

test('stock receipt rejects an expired batch', () => {
  const result = ReceiveStockSchema.safeParse({
    medicineId: '507f191e810c19729de860ea',
    batchNumber: 'B-1',
    manufacturingDate: '2024-01-01',
    expiryDate: '2025-01-01',
    costPriceMinor: 100,
    quantity: 10,
    warehouseLocation: 'A-1',
  });
  assert.equal(result.success, false);
});

test('FEFO uses earliest eligible batches and ignores blocked, quarantined and expired stock', () => {
  const now = new Date('2026-01-01');
  const result = planFefoAllocation(
    [
      {
        id: 'late',
        expiryDate: new Date('2027-01-01'),
        available: 8,
        isBlocked: false,
        isQuarantined: false,
      },
      {
        id: 'early',
        expiryDate: new Date('2026-03-01'),
        available: 4,
        isBlocked: false,
        isQuarantined: false,
      },
      {
        id: 'blocked',
        expiryDate: new Date('2026-02-01'),
        available: 99,
        isBlocked: true,
        isQuarantined: false,
      },
      {
        id: 'quarantine',
        expiryDate: new Date('2026-02-01'),
        available: 99,
        isBlocked: false,
        isQuarantined: true,
      },
      {
        id: 'expired',
        expiryDate: new Date('2025-12-31'),
        available: 99,
        isBlocked: false,
        isQuarantined: false,
      },
    ],
    7,
    now,
  );
  assert.deepEqual(result, [
    { batchId: 'early', quantity: 4 },
    { batchId: 'late', quantity: 3 },
  ]);
});

test('FEFO rejects demand above eligible stock', () => {
  assert.throws(
    () =>
      planFefoAllocation(
        [
          {
            id: 'only',
            expiryDate: new Date('2027-01-01'),
            available: 2,
            isBlocked: false,
            isQuarantined: false,
          },
        ],
        3,
        new Date('2026-01-01'),
      ),
    /Insufficient/,
  );
});

test('adjustment cannot create negative or consume committed stock', () => {
  assert.equal(availableAfterAdjustment(20, 5, 3), 12);
  assert.throws(() => availableAfterAdjustment(4, 5, 0), /committed/);
  assert.throws(() => availableAfterAdjustment(6, 5, 2), /negative/);
});
