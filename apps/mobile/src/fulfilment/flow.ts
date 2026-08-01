export type MobilePickingLine = {
  _id: string;
  medicineId: { _id: string; barcode?: string };
  batchId: string;
  quantity: number;
  pickedQuantity: number;
};

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
      pickedQuantity: Number(quantities[line._id]),
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
      const packedQuantity = Number(quantities[line._id]);
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
