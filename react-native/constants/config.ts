import Constants from 'expo-constants';

// API base URLs - configured for Docker/internal network
// In development, these connect to localhost. In production, use actual server URLs.
const DEV_API_HOST = 'http://localhost';
const PROD_API_HOST = 'http://localhost'; // Update with production URLs

const isDevelopment = __DEV__;

export const API = {
  USER_DATA: `${isDevelopment ? DEV_API_HOST : PROD_API_HOST}:5001`,
  PRODUCT: `${isDevelopment ? DEV_API_HOST : PROD_API_HOST}:5002`,
  SELLER: `${isDevelopment ? DEV_API_HOST : PROD_API_HOST}:5003`,
  SHIPPER: `${isDevelopment ? DEV_API_HOST : PROD_API_HOST}:5004`,
  PAYMENT: `${isDevelopment ? DEV_API_HOST : PROD_API_HOST}:5000`,
  SEARCH: `${isDevelopment ? DEV_API_HOST : PROD_API_HOST}:5005`,
  SSE: `${isDevelopment ? DEV_API_HOST : PROD_API_HOST}:4000`,
  WS: `${isDevelopment ? 'ws://localhost' : 'wss://api.xvstore.com'}:4000/ws`,
};

export const CLERK = {
  PUBLISHABLE_KEY: Constants.expoConfig?.extra?.clerkPublishableKey ?? '',
  // Fallback: users must set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY in .env
};

export const GEOAPIFY = {
  API_KEY: Constants.expoConfig?.extra?.geoapifyApiKey ?? '',
};

export const RAZORPAY = {
  API_KEY: Constants.expoConfig?.extra?.razorpayApiKey ?? '',
};

export const STORAGE_KEYS = {
  LOGIN_USER_TYPE: 'loginusertype',
  AUTH_TOKEN: 'auth-token',
  USER_DATA: 'user-data',
  ADMIN_DATA: 'admin-data',
  SHIPPER_DATA: 'shipper-data',
  CART_DATA: 'cart-data',
};
