import { create } from 'zustand';
import type { Medicine } from '@medsupply/shared-types';
type Item = { medicine: Medicine; quantity: number };
type State = {
  items: Item[];
  draftId?: string;
  add: (m: Medicine) => void;
  quantity: (id: string, q: number) => void;
  remove: (id: string) => void;
  recover: (items: Item[], draftId: string) => void;
  clear: () => void;
};
export const useCart = create<State>((set) => ({
  items: [],
  add: (medicine) =>
    set((state) => ({
      items: state.items.some((item) => item.medicine._id === medicine._id)
        ? state.items
        : state.items.concat({ medicine, quantity: medicine.minimumOrderQuantity }),
    })),
  quantity: (id, quantity) =>
    set((state) => ({
      items: state.items.map((item) => (item.medicine._id === id ? { ...item, quantity } : item)),
    })),
  remove: (id) =>
    set((state) => ({ items: state.items.filter((item) => item.medicine._id !== id) })),
  recover: (items, draftId) => set({ items, draftId }),
  clear: () => set({ items: [], draftId: undefined }),
}));
