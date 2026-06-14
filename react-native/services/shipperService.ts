import { shipperApi } from './api';
import { Shipper, DashboardStats, ShipperNotification } from '../types';

export const shipperService = {
  /** Fetch order by orderId */
  fetchOrder: (orderId: string) =>
    shipperApi.get<any>(`/fetch-user-order/${orderId}`),

  /** Fetch all orders assigned to shipper */
  fetchShipperOrders: (shipperId: string) =>
    shipperApi.get<any[]>(`/fetch-shipper-orders/${shipperId}`),

  /** Update order status via Kafka */
  updateOrderStatus: (orderId: string, status: string) =>
    shipperApi.patch<any>('/update-order-status', { orderId, status }),

  /** Update shipper live location */
  updateShipperLocation: (shipperId: string, location: { lat: number; lng: number }) =>
    shipperApi.post<any>('/update-shipper-location', { shipperId, location }),

  /** Get shipper location */
  getShipperLocation: (shipperId: string) =>
    shipperApi.get<{ lat: number; lng: number; timestamp: string }>(
      `/get-shipper-location/${shipperId}`
    ),

  /** Fetch delivered orders */
  fetchDeliveredOrders: (shipperId: string) =>
    shipperApi.get<any[]>(`/fetch-delivered-orders/${shipperId}`),

  /** Fetch dashboard stats */
  fetchDashboardStats: (shipperId: string) =>
    shipperApi.get<DashboardStats>(`/shipper-dashboard-stats/${shipperId}`),

  /** Fetch shipper notifications */
  fetchNotifications: (shipperId: string, statusFilter?: string) => {
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    return shipperApi.get<ShipperNotification[]>(
      `/shipper/notifications/${shipperId}${qs}`
    );
  },

  /** Mark notification as read */
  markNotificationRead: (notificationId: string, shipperId: string) =>
    shipperApi.post<any>(
      `/shipper/notifications/${notificationId}/read`,
      { shipperId }
    ),

  /** Get unread notification count */
  getUnreadCount: (shipperId: string) =>
    shipperApi.get<{ count: number }>(`/shipper/unread-count/${shipperId}`),

  /** Accept a delivery claim with Redis SETNX lock */
  acceptDelivery: (data: {
    shipperId: string;
    sellerOrderId: string;
    sellerId: string;
    orderId: string;
    pincode: string;
    products: Array<{ productId: string; quantity: number; productName?: string }>;
  }) => shipperApi.post<any>('/shipper/accept-delivery', data),

  /** Update shipper profile */
  updateShipperInfo: (data: {
    _id: string;
    shippername?: string;
    phone?: number;
    email?: string;
    geoPoint?: { lat?: number; lng?: number };
    address?: {
      pincode?: string;
      county?: string;
      country?: string;
      state?: string;
    };
  }) => shipperApi.patch<any>('/update-shipper-info', data),
};
