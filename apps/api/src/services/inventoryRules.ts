export type FefoCandidate = {
  id: string;
  expiryDate: Date;
  available: number;
  isBlocked: boolean;
  isQuarantined: boolean;
};

export type FefoAllocation = { batchId: string; quantity: number };

export function planFefoAllocation(
  candidates: FefoCandidate[],
  requested: number,
  now = new Date(),
): FefoAllocation[] {
  if (!Number.isInteger(requested) || requested <= 0)
    throw new Error('Requested quantity must be a positive integer');
  const eligible = candidates
    .filter(
      (batch) =>
        !batch.isBlocked && !batch.isQuarantined && batch.expiryDate > now && batch.available > 0,
    )
    .sort((left, right) => left.expiryDate.getTime() - right.expiryDate.getTime());
  if (eligible.reduce((total, batch) => total + batch.available, 0) < requested)
    throw new Error('Insufficient eligible stock');
  let remaining = requested;
  return eligible.flatMap((batch) => {
    if (remaining === 0) return [];
    const quantity = Math.min(remaining, batch.available);
    remaining -= quantity;
    return [{ batchId: batch.id, quantity }];
  });
}

export function availableAfterAdjustment(
  newOnHand: number,
  committed: number,
  unavailable: number,
): number {
  if (
    ![newOnHand, committed, unavailable].every(Number.isInteger) ||
    newOnHand < 0 ||
    committed < 0 ||
    unavailable < 0
  )
    throw new Error('Stock quantities must be non-negative integers');
  if (newOnHand < committed)
    throw new Error('Adjustment cannot reduce stock below committed quantity');
  const available = newOnHand - committed - unavailable;
  if (available < 0) throw new Error('Adjustment would create negative available stock');
  return available;
}
