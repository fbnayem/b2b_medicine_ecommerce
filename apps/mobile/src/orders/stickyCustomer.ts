import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The customer a rep was last working for, across app restarts.
 *
 * A rep visits one shop at a time and often places several orders in a visit,
 * so re-picking the customer every launch is the mobile version of the
 * queue-filter problem phase 23 fixed on the web.
 *
 * Storage lives here and nowhere else, exactly as `delivery/offlineQueue.ts`
 * keeps `AsyncStorage` out of `delivery/queueCore.ts`: the decision about
 * whether a remembered id may still be used is `resolveCustomer` in `entry.ts`,
 * which is pure and therefore tested. This file only reads and writes, and
 * never throws — a remembered choice is a convenience, and must not be the
 * reason order entry fails to open.
 */

const KEY = 'medsupply.orders.customer.v1';

export async function loadRememberedCustomer(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function rememberCustomer(shopId: string): Promise<void> {
  try {
    if (shopId) await AsyncStorage.setItem(KEY, shopId);
    else await AsyncStorage.removeItem(KEY);
  } catch {
    // The rep still picked a customer; the app simply will not recall it.
  }
}
