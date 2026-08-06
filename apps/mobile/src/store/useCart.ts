import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Medicine } from '@medsupply/shared-types';

/**
 * The basket: what was chosen and how many. **Never what it costs.**
 *
 * Two things were wrong, and they are opposite halves of the same mistake.
 *
 * **It held the whole `Medicine`, and the basket screen multiplied
 * `defaultSellingPriceMinor` by the quantity.** That is the list price, before
 * this shop's discount, their price list, any free goods and the delivery
 * charge — so the total on the screen was not the total on the invoice. The
 * money now comes from `POST /orders/quote` and only from there, and the shape
 * below has nowhere to put a price even if somebody tried.
 *
 * **It was not persisted at all**, so closing the application — or taking a
 * phone call during a twenty-line order — lost the lot. There is a "Save draft"
 * button, but a manual step nobody has been told about is not a recovery
 * mechanism. It now persists to `AsyncStorage`.
 *
 * `snapshot` is what the row needs before a quote lands and what the quantity
 * field clamps against. It is deliberately five fields rather than a `Medicine`,
 * because a stored `Medicine` is a stored price, and a stored price is the
 * defect above waiting to be reintroduced.
 */

export interface CartSnapshot {
  brandName: string;
  /** Optional on `Medicine` — a cream or a syrup may not have one. */
  strength?: string;
  minimum: number;
  maximum?: number;
}

export interface CartLine {
  medicineId: string;
  quantity: number;
  snapshot: CartSnapshot;
}

interface State {
  items: CartLine[];
  draftId?: string;
  /** True once the stored basket has been read back, so a screen can wait. */
  restored: boolean;
  add: (medicine: Medicine) => void;
  quantity: (medicineId: string, quantity: number) => void;
  remove: (medicineId: string) => void;
  setDraftId: (draftId?: string) => void;
  replace: (items: CartLine[], draftId?: string) => void;
  clear: () => void;
}

export function lineFor(medicine: Medicine): CartLine {
  return {
    medicineId: String(medicine._id),
    quantity: medicine.minimumOrderQuantity,
    snapshot: {
      brandName: medicine.brandName,
      strength: medicine.strength,
      minimum: medicine.minimumOrderQuantity,
      maximum: medicine.maximumOrderQuantity,
    },
  };
}

export const useCart = create<State>()(
  persist(
    (set) => ({
      items: [],
      restored: false,
      add: (medicine) =>
        set((state) => {
          const id = String(medicine._id);
          const found = state.items.find((item) => item.medicineId === id);
          if (!found) return { items: state.items.concat(lineFor(medicine)) };
          /*
           * Adding something already in the basket adds another minimum
           * quantity rather than doing nothing, which is what a second tap
           * means. Capped at the maximum, so it cannot be pushed past a limit
           * the server would refuse.
           */
          const next = Math.min(
            found.quantity + medicine.minimumOrderQuantity,
            medicine.maximumOrderQuantity ?? Number.MAX_SAFE_INTEGER,
          );
          return {
            items: state.items.map((item) =>
              item.medicineId === id ? { ...item, quantity: next } : item,
            ),
          };
        }),
      quantity: (medicineId, quantity) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.medicineId === medicineId ? { ...item, quantity } : item,
          ),
        })),
      remove: (medicineId) =>
        set((state) => ({ items: state.items.filter((item) => item.medicineId !== medicineId) })),
      setDraftId: (draftId) => set({ draftId }),
      replace: (items, draftId) => set({ items, draftId }),
      clear: () => set({ items: [], draftId: undefined }),
    }),
    {
      name: 'medsupply.basket',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: (state) => ({ items: state.items, draftId: state.draftId }),
      /*
       * Anything stored under an earlier version is discarded rather than
       * translated. There is no earlier version on this client — the basket has
       * never been persisted here — and the one shape it could plausibly grow
       * from is the web store's, which holds whole `Medicine` objects. Reading
       * one of those back would put a price into the basket again, which is the
       * single thing this file exists to prevent.
       */
      migrate: () => ({ items: [] as CartLine[], draftId: undefined }),
    },
  ),
);

/*
 * `AsyncStorage` answers a tick later than the first render, so a basket with
 * three things in it renders once as empty before the stored lines arrive.
 * `restored` lets the screen hold a spinner over that gap instead of showing
 * "Your basket is empty" to somebody whose basket is not.
 *
 * Set from outside the store because it describes the *storage*, not the
 * basket, and `partialize` above deliberately keeps it out of what is written.
 */
useCart.persist.onFinishHydration(() => useCart.setState({ restored: true }));
if (useCart.persist.hasHydrated()) useCart.setState({ restored: true });
