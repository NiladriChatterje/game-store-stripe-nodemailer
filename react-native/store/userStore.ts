import { create } from 'zustand';
import { User, UserCart } from '../types';

interface UserState {
  userData: User | null;
  cart: UserCart | null;
  cartSlideOpen: boolean;

  setUserData: (data: User | null) => void;
  setCart: (cart: UserCart | null) => void;
  setCartSlideOpen: (open: boolean) => void;
  clearUser: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  userData: null,
  cart: null,
  cartSlideOpen: false,

  setUserData: (data) => set({ userData: data }),
  setCart: (cart) => set({ cart }),
  setCartSlideOpen: (open) => set({ cartSlideOpen: open }),
  clearUser: () => set({ userData: null, cart: null, cartSlideOpen: false }),
}));
