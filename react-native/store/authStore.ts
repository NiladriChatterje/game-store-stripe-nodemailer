import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../constants/config';

interface AuthState {
  /** 'user' | 'admin' | 'shipper' */
  loginType: string;
  isHydrated: boolean;

  setLoginType: (type: string) => Promise<void>;
  hydrate: () => Promise<void>;
  clearLoginType: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  loginType: '',
  isHydrated: false,

  setLoginType: async (type: string) => {
    await AsyncStorage.setItem(STORAGE_KEYS.LOGIN_USER_TYPE, type);
    set({ loginType: type });
  },

  hydrate: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.LOGIN_USER_TYPE);
      set({ loginType: stored || '', isHydrated: true });
    } catch {
      set({ loginType: '', isHydrated: true });
    }
  },

  clearLoginType: async () => {
    await AsyncStorage.removeItem(STORAGE_KEYS.LOGIN_USER_TYPE);
    set({ loginType: '' });
  },
}));
