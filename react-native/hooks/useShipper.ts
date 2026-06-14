import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shipperService } from '../services/shipperService';
import { Shipper, DashboardStats, ShipperNotification } from '../types';

/** Hook to fetch shipper dashboard stats */
export function useShipperStats(shipperId: string | undefined) {
  return useQuery<DashboardStats>({
    queryKey: ['shipper-stats', shipperId],
    queryFn: async () => {
      if (!shipperId) throw new Error('Shipper ID is required');
      const res = await shipperService.fetchDashboardStats(shipperId);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch stats');
      return res.data;
    },
    enabled: !!shipperId,
    refetchInterval: 30000, // Poll every 30 seconds
  });
}

/** Hook to fetch shipper orders (in-transit) */
export function useShipperOrders(shipperId: string | undefined) {
  return useQuery<any[]>({
    queryKey: ['shipper-orders', shipperId],
    queryFn: async () => {
      if (!shipperId) throw new Error('Shipper ID is required');
      const res = await shipperService.fetchShipperOrders(shipperId);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch orders');
      return res.data;
    },
    enabled: !!shipperId,
    refetchInterval: 15000,
  });
}

/** Hook to fetch delivered orders */
export function useDeliveredOrders(shipperId: string | undefined) {
  return useQuery<any[]>({
    queryKey: ['delivered-orders', shipperId],
    queryFn: async () => {
      if (!shipperId) throw new Error('Shipper ID is required');
      const res = await shipperService.fetchDeliveredOrders(shipperId);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch delivered orders');
      return res.data;
    },
    enabled: !!shipperId,
  });
}

/** Hook to fetch shipper notifications */
export function useShipperNotifications(shipperId: string | undefined) {
  return useQuery<ShipperNotification[]>({
    queryKey: ['shipper-notifications', shipperId],
    queryFn: async () => {
      if (!shipperId) throw new Error('Shipper ID is required');
      const res = await shipperService.fetchNotifications(shipperId);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch notifications');
      return res.data;
    },
    enabled: !!shipperId,
    refetchInterval: 10000,
  });
}

/** Hook to fetch unread notification count */
export function useUnreadCount(shipperId: string | undefined) {
  return useQuery<{ count: number }>({
    queryKey: ['unread-count', shipperId],
    queryFn: async () => {
      if (!shipperId) throw new Error('Shipper ID is required');
      const res = await shipperService.getUnreadCount(shipperId);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch unread count');
      return res.data;
    },
    enabled: !!shipperId,
    refetchInterval: 15000,
  });
}

/** Mutation to accept a delivery claim */
export function useAcceptDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Parameters<typeof shipperService.acceptDelivery>[0]) => {
      const res = await shipperService.acceptDelivery(data);
      if (!res.ok) throw new Error(res.error || 'Failed to accept delivery');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipper-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['shipper-orders'] });
      queryClient.invalidateQueries({ queryKey: ['shipper-stats'] });
    },
  });
}

/** Mutation to update shipper profile */
export function useUpdateShipperProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Parameters<typeof shipperService.updateShipperInfo>[0]) => {
      const res = await shipperService.updateShipperInfo(data);
      if (!res.ok) throw new Error(res.error || 'Failed to update profile');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-data'] });
    },
  });
}

/** Mutation to update shipper live location */
export function useUpdateLocation() {
  return useMutation({
    mutationFn: async ({
      shipperId,
      location,
    }: {
      shipperId: string;
      location: { lat: number; lng: number };
    }) => {
      const res = await shipperService.updateShipperLocation(shipperId, location);
      if (!res.ok) throw new Error(res.error || 'Failed to update location');
      return res.data;
    },
  });
}

/** Mutation to update order status */
export function useUpdateOrderStatus() {
  return useMutation({
    mutationFn: async ({
      orderId,
      status,
    }: {
      orderId: string;
      status: string;
    }) => {
      const res = await shipperService.updateOrderStatus(orderId, status);
      if (!res.ok) throw new Error(res.error || 'Failed to update order status');
      return res.data;
    },
  });
}
