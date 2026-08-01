export function createFinancialIdempotencyKey(
  action: string,
  entityId: string,
  seed = `${Date.now()}-${Math.random().toString(36).slice(2)}`,
): string {
  const safeAction = action.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const safeEntity = entityId.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `mobile-${safeAction}-${safeEntity}-${seed}`.slice(0, 120);
}
