import mongoose from 'mongoose';
import { referenceYear } from '../services/localisation';

const counterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Number, required: true, default: 0 },
});

export const Counter = mongoose.model('Counter', counterSchema);

/**
 * The next human-readable reference in a per-year series — `ORD-2026-000001`.
 *
 * One atomic `$inc` per reference, so two concurrent callers cannot receive the
 * same number. That property is what makes this the only correct way to build a
 * reference in this system, and `Shop` was the one model not using it.
 *
 * The year comes from `referenceYear`, which reads the business zone rather
 * than UTC. `getUTCFullYear()` labels anything issued between midnight and 6 am
 * on 1 January in Dhaka with the previous year — a document dated 1 January
 * 2027 carrying `2026` in its reference.
 */
export async function nextReference(prefix: string): Promise<string> {
  const year = referenceYear();
  const counter = await Counter.findOneAndUpdate(
    { key: `${prefix}:${year}` },
    { $inc: { value: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `${prefix}-${year}-${String(counter.value).padStart(6, '0')}`;
}

/**
 * A block of consecutive references, claimed in one `$inc`.
 *
 * `nextReference` is one round trip per reference, which is correct and
 * unremarkable for an order. A catalogue import writes **55,998** rows, and at
 * one round trip each the numbering alone costs more than the rest of the import
 * put together — so a bulk caller claims the whole range at once and formats the
 * numbers locally.
 *
 * This keeps the property that makes the counter worth having: the `$inc` is
 * still atomic and still a single operation, so a concurrent caller receives the
 * range *after* this one and never a number inside it. What it gives up is
 * density — a caller that claims 55,998 and writes 40,000 leaves a gap. Gaps in
 * a reference series are harmless; two documents sharing a reference is not.
 */
export async function reserveReferences(prefix: string, count: number): Promise<string[]> {
  if (count <= 0) return [];
  const year = referenceYear();
  const counter = await Counter.findOneAndUpdate(
    { key: `${prefix}:${year}` },
    { $inc: { value: count } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  // `value` is the end of the block after the increment, so the block runs from
  // `value - count + 1` to `value` inclusive.
  const first = counter.value - count + 1;
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-${year}-${String(first + index).padStart(6, '0')}`,
  );
}
