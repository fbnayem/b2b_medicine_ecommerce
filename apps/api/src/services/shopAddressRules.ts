/**
 * Which of a shop's delivery addresses is *the* one.
 *
 * `isDefault` is a boolean on each element of an array, which is the storage
 * shape for a fact that is really about the array as a whole: **exactly one**
 * address is the default. Nothing enforced that. The seed script set one, the
 * admin form patched the array wholesale, and a shop could therefore hold two
 * defaults or none — at which point "where does this order go by default?" has
 * two answers or no answer, and the checkout screen quietly picked
 * `deliveryAddresses[0]` instead of asking.
 *
 * Every write that touches the array goes through `soleDefaultIndex`, so the
 * invariant is restored on the way out rather than hoped for on the way in.
 */

/**
 * A ceiling, because the addresses live inside the shop document.
 *
 * An unbounded array on a record read by the order screen, the checkout, the
 * customer list and every invoice snapshot is a document that grows until
 * something that reads it gets slow. Twenty is far more branches than a
 * pharmacy chain in this product has, and refusing the twenty-first is a
 * message somebody can act on; a 16MB document is not.
 */
export const MAX_DELIVERY_ADDRESSES = 20;

/**
 * The index that must carry `isDefault`, given the list and an optional wish.
 *
 * Returns `-1` for an empty list — a shop with no addresses has no default, and
 * that is a real state: it is exactly what a newly registered pharmacy looks
 * like before they have told us where to deliver.
 *
 * The precedence is: what the caller just asked for, then whatever is already
 * marked, then the first address. That last clause is what stops a shop ever
 * holding a list with no default: removing the marked one promotes its
 * neighbour rather than leaving the array without an answer.
 *
 * An index rather than a rebuilt array on purpose. The caller holds a Mongoose
 * document array, and rebuilding it from plain objects re-casts every element —
 * which is the manoeuvre that mints fresh `_id`s and silently invalidates the
 * address id an order draft is already holding.
 */
export function soleDefaultIndex(
  addresses: readonly { isDefault?: boolean }[],
  preferred = -1,
): number {
  if (addresses.length === 0) return -1;
  if (preferred >= 0 && preferred < addresses.length) return preferred;
  const marked = addresses.findIndex((address) => address.isDefault);
  return marked >= 0 ? marked : 0;
}

/** True when the list has one default and it sits where it should. */
export function hasSoleDefault(addresses: readonly { isDefault?: boolean }[]): boolean {
  return addresses.filter((address) => address.isDefault).length === (addresses.length ? 1 : 0);
}
