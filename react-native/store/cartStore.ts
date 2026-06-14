import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/config';
import { Product } from '../types';

export interface CartItemWithProduct {
  _id: string;
  productId: string;
  quantity: number;
  product?: Product;
}

interface CartState {
  items: CartItemWithProduct[];
  isOpen: boolean;

  addItem: (product: Product, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  setOpen: (open: boolean) => void;
  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
  getTotalPrice: () => number;
  getItemCount: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  isOpen: false,

  addItem: (product: Product, quantity = 1) => {
    const { items } = get();
    const existingIndex = items.findIndex(
      (item) => item.productId === product._id
    );

    if (existingIndex >= 0) {
      const updated = [...items];
      updated[existingIndex].quantity += quantity;
      set({ items: updated });
    } else {
      set({
        items: [
          ...items,
          {
            _id: product._id,
            productId: product._id,
            quantity,
            product,
          },
        ],
      });
    }
    get().persist();
  },

  removeItem: (productId: string) => {
    set({ items: get().items.filter((item) => item.productId !== productId) });
    get().persist();
  },

  updateQuantity: (productId: string, quantity: number) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return;
    }
    const updated = get().items.map((item) =>
      item.productId === productId ? { ...item, quantity } : item
    );
    set({ items: updated });
    get().persist();
  },

  clearCart: () => {
    set({ items: [] });
    AsyncStorage.removeItem(STORAGE_KEYS.CART_DATA);
  },

  setOpen: (open) => set({ isOpen: open }),

  hydrate: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.CART_DATA);
      if (stored) {
        set({ items: JSON.parse(stored) });
      }
    } catch {
      // Ignore hydration errors
    }
  },

  persist: async () => {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.CART_DATA,
        JSON.stringify(get().items)
      );
    } catch {
      // Ignore persist errors
    }
  },

  getTotalPrice: () => {
    return get().items.reduce((total, item) => {
      const price = item.product?.price?.pdtPrice ?? 0;
      return total + price * item.quantity;
    }, 0);
  },

  getItemCount: () => {
    return get().items.reduce((count, item) => count + item.quantity, 0);
  },
}));
