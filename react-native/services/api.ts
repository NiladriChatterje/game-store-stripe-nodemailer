import * as SecureStore from 'expo-secure-store';
import { API } from '../constants/config';

export interface ApiResponse<T = any> {
  data: T | null;
  error: string | null;
  status: number;
  ok: boolean;
}

/**
 * Retrieve the Clerk JWT token from SecureStore or generate it on the fly.
 * In practice, you would use Clerk's useAuth().getToken() hook.
 * This function is a fallback for non-hook contexts.
 */
let _getTokenFn: (() => Promise<string | null>) | null = null;

export function setGetTokenFn(fn: () => Promise<string | null>) {
  _getTokenFn = fn;
}

async function getAuthToken(): Promise<string | null> {
  if (_getTokenFn) {
    return _getTokenFn();
  }
  return SecureStore.getItemAsync('clerk-token');
}

/**
 * Generic authenticated fetch wrapper.
 * Automatically injects Authorization header with Clerk JWT token.
 */
async function request<T = any>(
  baseUrl: string,
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<ApiResponse<T>> {
  const { skipAuth, ...fetchOptions } = options;
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (!skipAuth) {
    const token = await getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
    });

    let data: T | null = null;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      data = await response.json();
    }

    return {
      data,
      error: response.ok ? null : `HTTP ${response.status}`,
      status: response.status,
      ok: response.ok,
    };
  } catch (error: any) {
    return {
      data: null,
      error: error.message || 'Network error',
      status: 0,
      ok: false,
    };
  }
}

// ---- Convenience methods ----

export function get<T = any>(baseUrl: string, path: string, skipAuth = false) {
  return request<T>(baseUrl, path, { method: 'GET', skipAuth });
}

export function post<T = any>(baseUrl: string, path: string, body?: any, skipAuth = false) {
  return request<T>(baseUrl, path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    skipAuth,
  });
}

export function put<T = any>(baseUrl: string, path: string, body?: any, skipAuth = false) {
  return request<T>(baseUrl, path, {
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
    skipAuth,
  });
}

export function patch<T = any>(baseUrl: string, path: string, body?: any, skipAuth = false) {
  return request<T>(baseUrl, path, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
    skipAuth,
  });
}

export function del<T = any>(baseUrl: string, path: string, skipAuth = false) {
  return request<T>(baseUrl, path, { method: 'DELETE', skipAuth });
}

// ---- Service-specific helpers ----

export const userDataApi = {
  get: <T = any>(path: string) => get<T>(API.USER_DATA, path),
  post: <T = any>(path: string, body?: any) => post<T>(API.USER_DATA, path, body),
  patch: <T = any>(path: string, body?: any) => patch<T>(API.USER_DATA, path, body),
};

export const productApi = {
  get: <T = any>(path: string) => get<T>(API.PRODUCT, path),
  post: <T = any>(path: string, body?: any) => post<T>(API.PRODUCT, path, body),
  patch: <T = any>(path: string, body?: any) => patch<T>(API.PRODUCT, path, body),
};

export const sellerApi = {
  get: <T = any>(path: string) => get<T>(API.SELLER, path),
  post: <T = any>(path: string, body?: any) => post<T>(API.SELLER, path, body),
  patch: <T = any>(path: string, body?: any) => patch<T>(API.SELLER, path, body),
};

export const shipperApi = {
  get: <T = any>(path: string) => get<T>(API.SHIPPER, path),
  post: <T = any>(path: string, body?: any) => post<T>(API.SHIPPER, path, body),
  patch: <T = any>(path: string, body?: any) => patch<T>(API.SHIPPER, path, body),
};

export const paymentApi = {
  get: <T = any>(path: string) => get<T>(API.PAYMENT, path),
  post: <T = any>(path: string, body?: any) => post<T>(API.PAYMENT, path, body),
  put: <T = any>(path: string, body?: any) => put<T>(API.PAYMENT, path, body),
};
