import { MedicineClassification, StockMovementType } from '@medsupply/shared-types';
import { Invoice } from '../models/Invoice';
import { Medicine } from '../models/Medicine';
import { MedicineBatch } from '../models/MedicineBatch';
import { StockMovement } from '../models/StockMovement';

/**
 * The movement return for prescription medicines.
 *
 * `MedicineClassification` has been stored on every medicine since the
 * catalogue phase — `PRESCRIPTION` or `OTC` — and **read by nothing**. A
 * distributor handling prescription-only medicines is expected to be able to
 * produce, for a period, what came in and what went out; without this the
 * answer existed in the data and not in any report.
 *
 * Built on `StockMovement`, which is already append-only and already records
 * the actor and their role on every row, so the register does not need a new
 * source of truth — only a question nobody had asked of the old one.
 */

export interface RegisterRow {
  medicineId: string;
  reference: string;
  brandName: string;
  genericName: string;
  strength: string;
  openingQuantity: number;
  receivedQuantity: number;
  despatchedQuantity: number;
  returnedQuantity: number;
  writtenOffQuantity: number;
  closingQuantity: number;
  /**
   * Opening + in − out, compared with what the shelf says.
   *
   * A register that only adds up its own movements can never disagree with
   * itself, which makes it useless as a control. This compares the arithmetic
   * against the batches and reports the difference.
   */
  varianceQuantity: number;
}

/** Movements that reduce the stock held, other than a sale. */
const WRITE_OFF_TYPES: string[] = [
  StockMovementType.DAMAGE,
  StockMovementType.EXPIRY,
  StockMovementType.ADJUSTMENT,
  StockMovementType.RETURN_DAMAGED,
  StockMovementType.RETURN_EXPIRED,
];

export async function controlledSubstanceRegister(input: { from: Date; to: Date }) {
  const medicines = await Medicine.find({
    classification: MedicineClassification.PRESCRIPTION,
  })
    .select('reference brandName genericName strength')
    .lean();

  if (medicines.length === 0) {
    return { period: { from: input.from, to: input.to }, rows: [] as RegisterRow[] };
  }

  const medicineIds = medicines.map((medicine) => medicine._id);

  const [before, during, onHand] = await Promise.all([
    // Everything up to the start of the period, which is the opening balance.
    StockMovement.aggregate([
      { $match: { medicineId: { $in: medicineIds }, createdAt: { $lt: input.from } } },
      { $group: { _id: '$medicineId', received: { $sum: signed('$type', '$quantity') } } },
    ]),
    StockMovement.aggregate([
      {
        $match: {
          medicineId: { $in: medicineIds },
          createdAt: { $gte: input.from, $lte: input.to },
        },
      },
      {
        $group: {
          _id: { medicineId: '$medicineId', type: '$type' },
          quantity: { $sum: '$quantity' },
        },
      },
    ]),
    MedicineBatch.aggregate([
      { $match: { medicineId: { $in: medicineIds } } },
      { $group: { _id: '$medicineId', onHand: { $sum: '$quantities.onHand' } } },
    ]),
  ]);

  const openingByMedicine = new Map<string, number>(
    before.map((row) => [String(row._id), row.received as number]),
  );
  const onHandByMedicine = new Map<string, number>(
    onHand.map((row) => [String(row._id), row.onHand as number]),
  );

  const movements = new Map<string, Map<string, number>>();
  for (const row of during) {
    const key = String(row._id.medicineId);
    if (!movements.has(key)) movements.set(key, new Map());
    movements.get(key)!.set(String(row._id.type), row.quantity as number);
  }

  const rows: RegisterRow[] = medicines.map((medicine) => {
    const key = String(medicine._id);
    const byType = movements.get(key) ?? new Map<string, number>();
    const quantityOf = (type: string) => byType.get(type) ?? 0;

    const opening = openingByMedicine.get(key) ?? 0;
    const received = quantityOf(StockMovementType.RECEIPT) + quantityOf(StockMovementType.ADDITION);
    const despatched = quantityOf(StockMovementType.PACKING);
    const returned =
      quantityOf(StockMovementType.RETURN_RESTOCK) + quantityOf(StockMovementType.RETURN_RECEIPT);
    const writtenOff = WRITE_OFF_TYPES.reduce((sum, type) => sum + quantityOf(type), 0);

    const closing = opening + received + returned - despatched - writtenOff;
    const actual = onHandByMedicine.get(key) ?? 0;

    return {
      medicineId: key,
      reference: medicine.reference,
      brandName: medicine.brandName,
      genericName: medicine.genericName,
      strength: medicine.strength,
      openingQuantity: opening,
      receivedQuantity: received,
      despatchedQuantity: despatched,
      returnedQuantity: returned,
      writtenOffQuantity: writtenOff,
      closingQuantity: closing,
      varianceQuantity: actual - closing,
    };
  });

  return { period: { from: input.from, to: input.to }, rows };
}

/** Adds receipts and subtracts everything that leaves, for the opening balance. */
function signed(typeField: string, quantityField: string) {
  return {
    $cond: [
      {
        $in: [
          typeField,
          [StockMovementType.RECEIPT, StockMovementType.ADDITION, StockMovementType.RETURN_RESTOCK],
        ],
      },
      quantityField,
      {
        $cond: [
          { $in: [typeField, [StockMovementType.PACKING, ...WRITE_OFF_TYPES]] },
          { $multiply: [quantityField, -1] },
          // Reservations, picking and their releases move stock between buckets
          // without changing how much is held, so they contribute nothing.
          0,
        ],
      },
    ],
  };
}

/**
 * Which prescription medicines a shop has bought, and how much.
 *
 * The other half of what an inspector asks: not only what left the warehouse
 * but who it went to.
 */
export async function controlledSubstanceByShop(input: { from: Date; to: Date }) {
  return Invoice.aggregate([
    { $match: { invoiceDate: { $gte: input.from, $lte: input.to } } },
    { $unwind: '$items' },
    {
      $lookup: {
        from: 'medicines',
        localField: 'items.medicineId',
        foreignField: '_id',
        as: 'medicine',
        pipeline: [
          { $match: { classification: MedicineClassification.PRESCRIPTION } },
          { $project: { reference: 1, brandName: 1, genericName: 1, strength: 1 } },
        ],
      },
    },
    { $match: { 'medicine.0': { $exists: true } } },
    {
      $group: {
        _id: { shopId: '$shopId', medicineId: '$items.medicineId' },
        shopSnapshot: { $first: '$shopSnapshot' },
        medicine: { $first: { $arrayElemAt: ['$medicine', 0] } },
        quantity: { $sum: '$items.quantity' },
        invoices: { $addToSet: '$reference' },
      },
    },
    { $sort: { quantity: -1 } },
  ]);
}
