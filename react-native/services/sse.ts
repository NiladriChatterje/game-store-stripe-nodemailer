import { API } from '../constants/config';
import * as SecureStore from 'expo-secure-store';

type SSEEventHandler = (data: any) => void;

/**
 * React Native doesn't have native EventSource support.
 * This is a polyfill using fetch with streaming for SSE.
 * Falls back to polling if streaming is not available.
 */
class SSEService {
  private abortController: AbortController | null = null;
  private handlers: Map<string, Set<SSEEventHandler>> = new Map();
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private _isConnected = false;

  /** Connect to an SSE endpoint */
  async connect(endpoint: string, params?: Record<string, string>): Promise<void> {
    this.disconnect();
    this.abortController = new AbortController();

    const url = new URL(`${API.SSE}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    try {
      const token = await SecureStore.getItemAsync('clerk-token');
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url.toString(), {
        headers,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      this._isConnected = true;
      this.emit('connected', { message: 'connected' });

      const reader = response.body?.getReader();
      if (!reader) {
        // Fallback to polling if streaming not available
        this.startPolling(endpoint, params);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              this.emit('message', data);

              if (data.topic) {
                this.emit(data.topic, data);
              }
            } catch {
              // Non-JSON data, emit as string
              this.emit('raw', dataStr);
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('[SSE] Connection error:', error.message);
        // Fallback to polling
        this.startPolling(endpoint, params);
      }
    }
  }

  /** Disconnect from SSE */
  disconnect(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.stopPolling();
    this._isConnected = false;
  }

  /** Listen for events */
  on(event: string, handler: SSEEventHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  /** Check if connected */
  get isConnected(): boolean {
    return this._isConnected;
  }

  private emit(event: string, data: any): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (e) {
        console.error(`[SSE] Error in handler for ${event}:`, e);
      }
    });
  }

  /** Fallback polling mechanism */
  private startPolling(endpoint: string, params?: Record<string, string>): void {
    if (this.pollingTimer) return;
    console.log('[SSE] Falling back to polling');

    this.pollingTimer = setInterval(async () => {
      try {
        const url = new URL(`${API.SSE}${endpoint}`);
        if (params) {
          Object.entries(params).forEach(([key, value]) => {
            url.searchParams.set(key, value);
          });
        }

        const token = await SecureStore.getItemAsync('clerk-token');
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(url.toString(), { headers });
        if (response.ok) {
          const data = await response.json();
          this.emit('message', data);
        }
      } catch {
        // Silently fail polling
      }
    }, 5000);
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
}

export const sseService = new SSEService();

// Pre-configured SSE endpoints
export const SSEEndpoints = {
  /** Admin/Seller dashboard events (subscriptions, orders) */
  adminEvents: (sellerId: string) => ({
    endpoint: '/events',
    params: { sellerId },
  }),
  /** Order real-time updates */
  orderEvents: (sellerId?: string) => ({
    endpoint: '/orders',
    ...(sellerId ? { params: { sellerId } } : {}),
  }),
  /** Shipper notification events (new deliveries) */
  shipperNotifications: (shipperId: string) => ({
    endpoint: '/shipper-notifications',
    params: { shipperId },
  }),
  /** Shipper assignment/status events */
  shipperEvents: (sellerId?: string) => ({
    endpoint: '/shipper-events',
    ...(sellerId ? { params: { sellerId } } : {}),
  }),
};
