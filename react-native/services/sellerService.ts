import { sellerApi } from './api';
import { Admin, DashboardMetrics, SellerOrder, Store, StoreGroup } from '../types';

export const sellerService = {
  /** Create admin via Kafka */
  createAdmin: (adminData: any) =>
    sellerApi.post<any>('/create-admin', adminData),

  /** Fetch admin data by ID */
  fetchAdminData: (adminId: string) =>
    sellerApi.get<Admin>(`/fetch-admin-data/${adminId}`),

  /** Update admin info */
  updateAdminInfo: (adminData: any) =>
    sellerApi.patch<any>('/update-admin-info', adminData),

  /** Configure a new store */
  configureStore: (storeData: {
    storeId: string;
    sellerId: string;
    store_name: string;
    address_line1: string;
    address_line2?: string;
    pincode: string;
    county: string;
    state: string;
    country: string;
  }) => sellerApi.post<any>('/configure-store', storeData),

  /** Fetch product list for admin */
  fetchProductList: (adminId: string) =>
    sellerApi.get<any[]>(`/${adminId}/product-list`),

  /** Fetch dashboard metrics */
  fetchDashboardMetrics: (adminId: string, fromDate?: string, toDate?: string) => {
    const params = new URLSearchParams();
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    const qs = params.toString();
    return sellerApi.get<DashboardMetrics>(
      `/${adminId}/dashboard-metrics${qs ? `?${qs}` : ''}`
    );
  },

  /** Fetch admin's products grouped by store */
  fetchProducts: (adminId: string) =>
    sellerApi.get<StoreGroup[]>(`/${adminId}/fetch-products`),

  /** Fetch seller orders */
  fetchSellerOrders: (sellerId: string) =>
    sellerApi.get<SellerOrder[]>(`/seller-orders/${sellerId}`),

  /** Update seller order status */
  updateSellerOrderStatus: (sellerOrderId: string, status: string) =>
    sellerApi.patch<any>(`/seller-order-status/${sellerOrderId}`, { status }),

  /** Reject seller order with reason */
  rejectSellerOrder: (sellerOrderId: string, rejectionReason: string) =>
    sellerApi.patch<any>(`/seller-order-reject/${sellerOrderId}`, { rejectionReason }),

  /** Fetch all shippers (for admin assignment) */
  fetchAllShippers: () =>
    sellerApi.get<any[]>('/fetch-all-shippers'),

  /** Assign shipper to order */
  assignShipper: (data: {
    sellerOrderId: string;
    shipperId: string;
    orderId: string;
    sellerId: string;
    pincode?: string;
    products: Array<{ productId: string; quantity: number }>;
    notes?: string;
  }) => sellerApi.post<any>('/assign-shipper', data),

  /** Fetch seller order shippers */
  fetchSellerOrderShippers: (sellerId: string) =>
    sellerApi.get<any[]>(`/seller-order-shippers/${sellerId}`),

  /** Fetch shipper shipment details (fraud tracing) */
  fetchShipperShipmentDetails: (shipperId: string) =>
    sellerApi.get<any>(`/shipper-shipment-details/${shipperId}`),

  /** Update shipping status */
  updateShippingStatus: (shippingId: string, data: { status: string; notes?: string; pincode?: string }) =>
    sellerApi.patch<any>(`/update-shipping-status/${shippingId}`, data),
};
