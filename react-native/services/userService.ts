import { userDataApi } from './api';
import { User, UserCart, DeliveryOrder, Address, GeoPoint } from '../types';

export const userService = {
  /** Fetch user data by Clerk ID */
  fetchUserData: (userId: string) =>
    userDataApi.get<User>(`/fetch-user-data/${userId}`),

  /** Create user via Kafka */
  createUser: (userData: {
    _id: string;
    username: string;
    geoPoint?: GeoPoint;
    email: string;
    address?: Address;
    cart?: Array<{ _id: string; quantity: number }>;
  }) => userDataApi.post<any>('/create-user', userData),

  /** Fetch user cart */
  fetchUserCart: (userId: string) =>
    userDataApi.get<UserCart>(`/fetch-user-cart/${userId}`),

  /** Fetch delivery orders for user */
  fetchDeliveryOrders: (userId: string) =>
    userDataApi.post<DeliveryOrder[]>(`/delivery-orders/${userId}`),

  /** Update user info via worker thread */
  updateUserInfo: (userData: Partial<User>) =>
    userDataApi.patch<any>('/update-user-info', userData),

  /** Send OTP to email */
  sendEmailOtp: (recipient: string) =>
    userDataApi.post<any>('/fetch-mail-otp', { recipient }),

  /** Send OTP to phone */
  sendPhoneOtp: () =>
    userDataApi.post<any>('/fetch-phone-otp'),

  /** Fetch shipper data (for shipper account) */
  fetchShipperData: (shipperId: string) =>
    userDataApi.get<User>(`/fetch-shipper-data/${shipperId}`),

  /** Create shipper */
  createShipper: (data: { _id: string; username: string; email: string }) =>
    userDataApi.post<any>('/create-shipper', data),
};
