import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Number, required: true, default: 0 },
});

export const Counter = mongoose.model('Counter', counterSchema);

export async function nextReference(prefix: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  const counter = await Counter.findOneAndUpdate(
    { key: `${prefix}:${year}` },
    { $inc: { value: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `${prefix}-${year}-${String(counter.value).padStart(6, '0')}`;
}
