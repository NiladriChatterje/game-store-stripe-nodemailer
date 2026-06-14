import { create } from 'zustand';
import { Shipper, DashboardStats } from '../types';

interface ShipperState {
  shipperData: Shipper | null;
  stats: DashboardStats;
  sidebarOpen: boolean;
  profileComplete: boolean | null;

  setShipperData: (data: Shipper | null) => void;
  setStats: (stats: DashboardStats) => void;
  setSidebarOpen: (open: boolean) => void;
  setProfileComplete: (complete: boolean | null) => void;
  clearShipper: () => void;
}

export const useShipperStore = create<ShipperState>((set) => ({
  shipperData: null,
  stats: { pending: 0, inTransit: 0, delivered: 0 },
  sidebarOpen: false,
  profileComplete: null,

  setShipperData: (data) => set({ shipperData: data }),
  setStats: (stats) => set({ stats }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setProfileComplete: (complete) => set({ profileComplete: complete }),
  clearShipper: () =>
    set({
      shipperData: null,
      stats: { pending: 0, inTransit: 0, delivered: 0 },
      profileComplete: null,
    }),
}));
