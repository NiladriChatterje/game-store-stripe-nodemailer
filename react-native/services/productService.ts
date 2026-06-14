import { productApi } from './api';
import { Product, ProductDetail } from '../types';

export const productService = {
  /** Fetch products by pincode, category, and page */
  fetchProducts: (pincode: number, category: string, page: number) =>
    productApi.get<Product[]>(`/fetch-products/${pincode}/${category}/${page}`),

  /** Fetch single product detail by pincode and product ID */
  fetchProductDetail: (pincode: string, productId: string) =>
    productApi.get<ProductDetail>(`/fetch-product-detail/${pincode}/${productId}`),

  /** Fetch product by ID (searches all shards) */
  fetchProductById: (productId: string) =>
    productApi.get<Product[]>(`/fetch-product/${productId}`),

  /** Fetch product quantity */
  fetchProductQuantity: (pincode: string, productId: string) =>
    productApi.get<{ quantity: number }>(`/fetch-product-quantity/${pincode}/${productId}`),

  /** Add product via Kafka */
  addProduct: (productData: any) =>
    productApi.post<any>('/add-product', productData),

  /** Update product via Kafka */
  updateProduct: (productData: any) =>
    productApi.patch<any>('/update-product', productData),
};
