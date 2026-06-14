import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sellerService } from '../services/sellerService';
import { Admin, DashboardMetrics, SellerOrder, StoreGroup } from '../types';

/** Hook to fetch admin data */
export function useAdminData(adminId: string | undefined) {
  return useQuery<Admin>({
    queryKey: ['admin-data', adminId],
    queryFn: async () => {
      if (!adminId) throw new Error('Admin ID is required');
      const res = await sellerService.fetchAdminData(adminId);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch admin data');
      return res.data;
    },
    enabled: !!adminId,
    refetchOnMount: true,
  });
}

/** Hook to fetch dashboard metrics */
export function useDashboardMetrics(
  adminId: string | undefined,
  fromDate?: string,
  toDate?: string
) {
  return useQuery<DashboardMetrics>({
    queryKey: ['dashboard-metrics', adminId, fromDate, toDate],
    queryFn: async () => {
      if (!adminId) throw new Error('Admin ID is required');
      const res = await sellerService.fetchDashboardMetrics(adminId, fromDate, toDate);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch metrics');
      return res.data;
    },
    enabled: !!adminId,
  });
}

/** Hook to fetch admin's products grouped by store */
export function useAdminProducts(adminId: string | undefined) {
  return useQuery<StoreGroup[]>({
    queryKey: ['admin-products', adminId],
    queryFn: async () => {
      if (!adminId) throw new Error('Admin ID is required');
      const res = await sellerService.fetchProducts(adminId);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch products');
      return res.data;
    },
    enabled: !!adminId,
  });
}

/** Hook to fetch seller orders */
export function useSellerOrders(sellerId: string | undefined) {
  return useQuery<SellerOrder[]>({
    queryKey: ['seller-orders', sellerId],
    queryFn: async () => {
      if (!sellerId) throw new Error('Seller ID is required');
      const res = await sellerService.fetchSellerOrders(sellerId);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch orders');
      return res.data;
    },
    enabled: !!sellerId,
    refetchInterval: 15000, // Poll every 15 seconds
  });
}

/** Mutation to update seller order status */
export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sellerOrderId,
      status,
    }: {
      sellerOrderId: string;
      status: string;
    }) => {
      const res = await sellerService.updateSellerOrderStatus(sellerOrderId, status);
      if (!res.ok) throw new Error(res.error || 'Failed to update order status');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}

/** Mutation to reject seller order */
export function useRejectOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sellerOrderId,
      reason,
    }: {
      sellerOrderId: string;
      reason: string;
    }) => {
      const res = await sellerService.rejectSellerOrder(sellerOrderId, reason);
      if (!res.ok) throw new Error(res.error || 'Failed to reject order');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
    },
  });
}

/** Mutation to configure a new store */
export function useConfigureStore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (storeData: Parameters<typeof sellerService.configureStore>[0]) => {
      const res = await sellerService.configureStore(storeData);
      if (!res.ok) throw new Error(res.error || 'Failed to configure store');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-data'] });
    },
  });
}

/** Mutation to update admin info */
export function useUpdateAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (adminData: any) => {
      const res = await sellerService.updateAdminInfo(adminData);
      if (!res.ok) throw new Error(res.error || 'Failed to update admin');
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-data', variables._id] });
    },
  });
}

/** Hook to fetch all shippers (for admin assignment) */
export function useAllShippers() {
  return useQuery<any[]>({
    queryKey: ['all-shippers'],
    queryFn: async () => {
      const res = await sellerService.fetchAllShippers();
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch shippers');
      return res.data;
    },
  });
}

/** Mutation to assign a shipper */
export function useAssignShipper() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Parameters<typeof sellerService.assignShipper>[0]) => {
      const res = await sellerService.assignShipper(data);
      if (!res.ok) throw new Error(res.error || 'Failed to assign shipper');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
      queryClient.invalidateQueries({ queryKey: ['seller-order-shippers'] });
    },
  });
}
