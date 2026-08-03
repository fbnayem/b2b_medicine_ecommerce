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
