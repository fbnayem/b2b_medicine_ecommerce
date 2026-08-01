import { describe, expect, it } from 'vitest';
import { buildPackingConfirmation, buildPickingProgress, findLineForBarcode } from './flow';

const lines = [
  {
    _id: 'line-1',
    medicineId: { _id: 'medicine-1', barcode: '1234567890128' },
    batchId: 'batch-1',
    quantity: 3,
    pickedQuantity: 2,
  },
];

describe('mobile fulfilment flow payloads', () => {
  it('matches either a medicine barcode or exact allocated batch ID', () => {
    expect(findLineForBarcode(lines, ' 1234567890128 ')?._id).toBe('line-1');
    expect(findLineForBarcode(lines, 'batch-1')?._id).toBe('line-1');
    expect(findLineForBarcode(lines, 'wrong')).toBeUndefined();
  });

  it('builds versioned pause and quantity confirmation data', () => {
    expect(buildPickingProgress(4, lines, { 'line-1': '2' }, 'PAUSE')).toEqual({
      version: 4,
      action: 'PAUSE',
      items: [{ medicineId: 'medicine-1', batchId: 'batch-1', pickedQuantity: 2 }],
    });
  });

  it('adds a shortfall reason only to reduced packed lines', () => {
    expect(
      buildPackingConfirmation(5, lines, { 'line-1': '1' }, 'One unit missing', 'batch-1', 2, 750),
    ).toEqual({
      version: 5,
      items: [
        {
          medicineId: 'medicine-1',
          batchId: 'batch-1',
          packedQuantity: 1,
          shortfallReason: 'One unit missing',
        },
      ],
      packageCount: 2,
      weightGrams: 750,
      notes: 'Barcode confirmed: batch-1',
    });
  });
});
