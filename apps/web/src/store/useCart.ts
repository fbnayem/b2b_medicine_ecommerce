import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Medicine } from '@medsupply/shared-types';
type CartItem = { medicine: Medicine; quantity: number; notes?: string };
type CartState = {
  items: CartItem[];
  draftId?: string;
  add: (medicine: Medicine) => void;
  setQuantity: (id: string, quantity: number) => void;
  remove: (id: string) => void;
  setDraftId: (id?: string) => void;
  clear: () => void;
};
export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      add: (medicine) =>
        set((state) => {
          const found = state.items.find((item) => item.medicine._id === medicine._id);
          return {
            items: found
              ? state.items.map((item) =>
                  item.medicine._id === medicine._id
                    ? {
                        ...item,
                        quantity: Math.min(
                          item.quantity + medicine.minimumOrderQuantity,
                          medicine.maximumOrderQuantity ?? Number.MAX_SAFE_INTEGER,
                        ),
                      }
                    : item,
                )
              : [...state.items, { medicine, quantity: medicine.minimumOrderQuantity }],
          };
        }),
      setQuantity: (id, quantity) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.medicine._id === id ? { ...item, quantity } : item,
          ),
        })),
      remove: (id) =>
        set((state) => ({ items: state.items.filter((item) => item.medicine._id !== id) })),
      setDraftId: (draftId) => set({ draftId }),
      clear: () => set({ items: [], draftId: undefined }),
    }),
    {
      name: 'medsupply-cart',
      partialize: (state) => ({ items: state.items, draftId: state.draftId }),
    },
  ),
);
