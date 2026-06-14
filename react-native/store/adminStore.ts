import { create } from 'zustand';
import { Admin } from '../types';

interface AdminState {
  admin: Admin | null;
  isPlanActive: boolean;
  sidebarOpen: boolean;

  setAdmin: (admin: Admin | null) => void;
  setIsPlanActive: (active: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  clearAdmin: () => void;
}

export const useAdminStore = create<AdminState>((set) => ({
  admin: null,
  isPlanActive: false,
  sidebarOpen: false,

  setAdmin: (admin) => set({ admin }),
  setIsPlanActive: (active) => set({ isPlanActive: active }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  clearAdmin: () => set({ admin: null, isPlanActive: false, sidebarOpen: false }),
}));
