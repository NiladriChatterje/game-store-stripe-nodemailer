export enum EanUpcIsbnType {
  EAN = 'EAN',
  UPC = 'UPC',
  ISBN = 'ISBN',
  ASIN = 'ASIN',
  GTIN = 'GTIN',
  OTHERS = 'OTHERS',
}

export enum Currency {
  INR = 'INR',
  YEN = 'YEN',
  USD = 'USD',
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

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  SHIPPER = 'shipper',
}

export enum OrderStatus {
  ORDER_PLACED = 'orderPlaced',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  PROCESSING = 'processing',
  READY_TO_SHIP = 'ready_to_ship',
  DISPATCHED = 'dispatched',
  SHIPPING = 'shipping',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
}

export const PRODUCT_CATEGORIES_LIST = [
  { label: 'All', value: ProductCategories.ALL },
  { label: 'Clothing', value: ProductCategories.CLOTH },
  { label: 'Food', value: ProductCategories.FOOD },
  { label: 'Groceries', value: ProductCategories.GROCERIES },
  { label: 'Gadgets', value: ProductCategories.GADGETS },
  { label: 'Home Goods', value: ProductCategories.HOME_GOODS },
  { label: 'Toys', value: ProductCategories.TOYS },
];
