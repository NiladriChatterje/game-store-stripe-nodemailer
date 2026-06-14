import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productService } from '../services/productService';
import { Product, ProductDetail } from '../types';

/** Hook to fetch paginated products by pincode and category */
export function useProducts(
  pincode: number,
  category: string,
  page: number = 1
) {
  return useQuery<Product[]>({
    queryKey: ['products', pincode, category, page],
    queryFn: async () => {
      const res = await productService.fetchProducts(pincode, category, page);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch products');
      return Array.isArray(res.data) ? res.data : [];
    },
    placeholderData: (prev) => prev, // Keep previous data while fetching
  });
}

/** Hook to fetch a single product detail */
export function useProductDetail(pincode: string, productId: string) {
  return useQuery<ProductDetail>({
    queryKey: ['product-detail', pincode, productId],
    queryFn: async () => {
      const res = await productService.fetchProductDetail(pincode, productId);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch product detail');
      return res.data;
    },
    enabled: !!pincode && !!productId,
  });
}

/** Hook to fetch a product by ID (searches all shards) */
export function useProductById(productId: string) {
  return useQuery<Product[]>({
    queryKey: ['product', productId],
    queryFn: async () => {
      const res = await productService.fetchProductById(productId);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch product');
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!productId,
  });
}

/** Hook to fetch product quantity */
export function useProductQuantity(pincode: string, productId: string) {
  return useQuery<{ quantity: number }>({
    queryKey: ['product-quantity', pincode, productId],
    queryFn: async () => {
      const res = await productService.fetchProductQuantity(pincode, productId);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to fetch quantity');
      return res.data;
    },
    enabled: !!pincode && !!productId,
  });
}

/** Mutation hook to add a product */
export function useAddProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (productData: any) => {
      const res = await productService.addProduct(productData);
      if (!res.ok) throw new Error(res.error || 'Failed to add product');
      return res.data;
    },
    onSuccess: () => {
      // Invalidate product list queries
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/** Mutation hook to update a product */
export function useUpdateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (productData: any) => {
      const res = await productService.updateProduct(productData);
      if (!res.ok) throw new Error(res.error || 'Failed to update product');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-detail'] });
    },
  });
}
