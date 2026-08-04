export type MobilePickingLine = {
  _id: string;
  medicineId: { _id: string; barcode?: string };
  batchId: string;
  quantity: number;
  pickedQuantity: number;
};

/**
 * A quantity from a text field, as a whole number of units.
 *
 * Both builders read `Number(quantities[line._id])`, so a picker who cleared a
 * field sent `NaN` and one who fat-fingered a letter sent `NaN` too — into the
 * payload that decides what gets invoiced. The same defect the cart and the
 * approval screen carried, in the one place it decides what leaves the
 * warehouse.
 */
function units(value: string | undefined): number {
  const digits = (value ?? '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

export function findLineForBarcode(lines: MobilePickingLine[], rawCode: string) {
  const code = rawCode.trim();
  return lines.find((line) => line.medicineId.barcode === code || line.batchId === code);
}

export function buildPickingProgress(
  version: number,
  lines: MobilePickingLine[],
  quantities: Record<string, string>,
  action: 'SAVE' | 'PAUSE' | 'COMPLETE',
) {
  return {
    version,
    action,
    items: lines.map((line) => ({
      medicineId: line.medicineId._id,
      batchId: line.batchId,
      pickedQuantity: units(quantities[line._id]),
    })),
  };
}

export function buildPackingConfirmation(
  version: number,
  lines: MobilePickingLine[],
  quantities: Record<string, string>,
  shortfallReason: string,
  confirmedBarcode: string,
  packageCount: number,
  weightGrams?: number,
) {
  return {
    version,
    items: lines.map((line) => {
      const packedQuantity = units(quantities[line._id]);
      return {
        medicineId: line.medicineId._id,
        batchId: line.batchId,
        packedQuantity,
        shortfallReason: packedQuantity < line.pickedQuantity ? shortfallReason : undefined,
      };
    }),
    packageCount,
    weightGrams,
    notes: confirmedBarcode ? `Barcode confirmed: ${confirmedBarcode}` : undefined,
  };
}
