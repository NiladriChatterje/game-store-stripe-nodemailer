// ============================================================
// Product Types
// ============================================================
export interface ProductPrice {
  pdtPrice: number;
  discountPercentage: number;
  currency: string;
}

export interface ProductImage {
  size: string;
  base64: string;
  extension: string;
}

export interface Product {
  _id: string;
  productName: string;
  category: string;
  price: ProductPrice;
  quantity: number;
  imagesBase64: ProductImage[];
  keywords: string[];
  eanUpcNumber?: string;
  eanUpcIsbnGtinAsinType?: string;
  productDescription?: string;
  modelNumber?: string;
  pincode?: string;
}

export interface ProductDetail extends Product {
  quantity: number;
}

// ============================================================
// User Types
// ============================================================
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface Address {
  pincode: string;
  county: string;
  country: string;
  state: string;
}

export interface User {
  _id: string;
  username: string;
  email: string;
  phone?: number;
  geoPoint?: GeoPoint | null;
  address?: Address | null;
}

export interface CartItem {
  productId: string;
  quantity: number;
  product?: Product;
}

export interface UserCart {
  cart: CartItem[];
}

// ============================================================
// Order Types
// ============================================================
export type OrderStatus =
  | 'orderPlaced'
  | 'accepted'
  | 'rejected'
  | 'processing'
  | 'ready_to_ship'
  | 'dispatched'
  | 'shipping'
  | 'shipped'
  | 'delivered';

export interface Order {
  _id: string;
  orderId: string;
  customer_id?: string;
  shipper_id?: string;
  quantity: number;
  transactionId: string;
  paymentSignature: string;
  amount: number;
  status: OrderStatus;
  _createdAt: string;
  expectedDelivery: string | null;
}

export interface DeliveryOrder extends Order {
  customer?: User | null;
}

// ============================================================
// Seller Order Types
// ============================================================
export interface SellerOrderProduct {
  product: {
    _id: string;
    _ref: string;
  };
  quantity: number;
  price: number;
}

export interface ShipperAssignment {
  shippingId: string;
  shipperId: string;
  status: string;
  assignedAt: string;
  shippedAt?: string;
  deliveredAt?: string;
  notes?: string;
  shipperName?: string;
  shipperPhone?: string;
  shipperEmail?: string;
}

export interface SellerOrder {
  _id: string;
  orderId: string;
  seller: {
    _id: string;
    _ref: string;
  };
  status: string;
  totalAmount: number;
  isPartialFulfillment: boolean;
  notes?: string;
  acceptedAt?: string;
  rejectionReason?: string;
  _createdAt: string;
  pincode: string;
  products: SellerOrderProduct[];
  shippers: ShipperAssignment[];
}

// ============================================================
// Admin/Seller Types
// ============================================================
export interface SubscriptionPlan {
  _key?: string;
  transactionId: string;
  orderId: string;
  paymentSignature: string;
  amount: number;
  storeAllotment: number;
  planSchemaList: {
    activeDate: string;
    expireDate: string;
  };
}

export interface Admin {
  _id: string;
  _type: string;
  username: string;
  gstin?: string;
  email: string;
  phone?: number;
  geoPoint?: GeoPoint;
  address?: Address;
  subscriptionPlan: SubscriptionPlan[];
  stores?: Store[];
  isPlanActive?: boolean;
}

export interface Store {
  id: number;
  store_number?: number;
  pincode: string;
  shard_host?: string;
  store_name: string;
  address_line1: string;
  address_line2?: string;
  county: string;
  state: string;
  country: string;
}

export interface DashboardMetrics {
  totalSales: { value: string; trend: string; numericValue: number };
  totalProfit: { value: string; trend: string; numericValue: number };
  ordersServed: { value: string; trend: string; numericValue: number };
  activeCustomers: { value: string; trend: string; numericValue: number };
  monthlyRevenue: { value: string; trend: string; numericValue: number };
  productsSold: { value: string; trend: string; numericValue: number };
  totalProductsInInventory: { value: number; trend: string; numericValue: number };
  timeSeries: {
    labels: string[];
    salesData: number[];
    profitData: number[];
    ordersData: number[];
  };
}

// ============================================================
// Shipper Types
// ============================================================
export interface Shipper {
  _id: string;
  shippername: string;
  email: string;
  phone: number;
  geo_lat?: number;
  geo_lng?: number;
  address?: Address | null;
  createdAt?: string;
}

export interface DashboardStats {
  pending: number;
  inTransit: number;
  delivered: number;
}

export interface ShipperNotification {
  id: string;
  type: string;
  sellerOrderId: string;
  orderId: string;
  sellerId: string;
  pincode: string;
  amount: number;
  readStatus: 'unread' | 'read' | 'claimed' | 'expired';
  claimStatus: 'pending' | 'accepted' | 'rejected_by_other';
  claimedAt?: string;
  createdAt: string;
  products?: Array<{ productId: string; quantity: number; productName?: string }>;
}

// ============================================================
// Payment Types
// ============================================================
export interface RazorpayOrderResponse {
  id: string;
  currency: string;
  amount: number;
  status: number;
}

export interface Subscription {
  _id: string;
  username?: string;
  email?: string;
  subscriptionPlan: {
    transactionId: string;
    orderId: string;
    paymentSignature: string;
    amount: number;
    storeAllotment: number;
    planSchemaList: {
      activeDate: string;
      expireDate: string;
    };
  };
}

// ============================================================
// Enum Types
// ============================================================
export enum EanUpcIsbnType {
  EAN = 'EAN',
  UPC = 'UPC',
  ISBN = 'ISBN',
  ASIN = 'ASIN',
  GTIN = 'GTIN',
  OTHERS = 'OTHERS',
}

export enum ProductCategories {
  ALL = 'all',
  CLOTH = 'clothing',
  FOOD = 'food',
  GROCERIES = 'groceries',
  GADGETS = 'gadgets',
  HOME_GOODS = 'home-goods',
  TOYS = 'toys',
}

export enum Currency {
  INR = 'INR',
  YEN = 'YEN',
  USD = 'USD',
}

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  SHIPPER = 'shipper',
}

// ============================================================
// Store Group (Admin products grouped by store)
// ============================================================
export interface StoreGroup {
  storeInfo: {
    id: number;
    store_number?: number;
    pincode: string;
    shard_host?: string;
    county: string;
    state: string;
    country: string;
  };
  products: Product[];
}
