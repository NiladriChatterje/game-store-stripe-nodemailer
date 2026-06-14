import { paymentApi } from './api';
import { RazorpayOrderResponse, Subscription } from '../types';

export const paymentService = {
  /** Create Razorpay order */
  createRazorpayOrder: (price: number, currency = 'INR') =>
    paymentApi.post<RazorpayOrderResponse>('/razorpay', { price, currency }),

  /** Process seller subscription via Kafka */
  createSubscription: (data: Subscription) =>
    paymentApi.post<any>('/seller-subscription', data),

  /** Place user order (update product quantity + send email) */
  placeOrder: (data: {
    customer: string;
    customerEmail: string;
    product: string;
    transactionId: string;
    orderId: string;
    paymentSignature: string;
    amount: number;
    pincode: number;
    quantity: number;
  }) => paymentApi.put<any>('/user-order', data),

  /** Process refund via Razorpay */
  processRefund: (data: {
    orderId: string;
    transactionId: string;
    refundAmount: number;
    reason: string;
    customerEmail: string;
  }) => paymentApi.post<any>('/process-refund', data),
};
