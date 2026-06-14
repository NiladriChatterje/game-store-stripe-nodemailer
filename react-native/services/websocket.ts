import { API } from '../constants/config';

type MessageHandler = (data: any) => void;

interface WSMessage {
  type: string;
  [key: string]: any;
}

class LiveTrackingSocket {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnected = false;

  /** Connect to the WebSocket server */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(API.WS);

      this.ws.onopen = () => {
        console.log('[WS] Connected to live tracking server');
        this.isConnected = true;
        this.emit('connected', {});
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          const { type, ...payload } = data;
          if (type) {
            this.emit(type, payload);
          }
          // Also emit raw data
          this.emit('message', data);
        } catch (e) {
          console.error('[WS] Error parsing message:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected');
        this.isConnected = false;
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
      };
    } catch (e) {
      console.error('[WS] Connection error:', e);
      this.scheduleReconnect();
    }
  }

  /** Disconnect from the WebSocket server */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /** Send a message to the WebSocket server */
  send(message: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[WS] Cannot send message - not connected');
    }
  }

  /** Register a shipper for a delivery order */
  registerShipper(shipperId: string, orderId: string): void {
    this.send({ type: 'shipper:register', shipperId, orderId });
  }

  /** Push live location update from shipper */
  updateLocation(shipperId: string, orderId: string, lat: number, lng: number): void {
    this.send({ type: 'shipper:location-update', shipperId, orderId, lat, lng });
  }

  /** Subscribe to an order's live tracking (user side) */
  subscribeToOrder(orderId: string): void {
    this.send({ type: 'user:subscribe-order', orderId });
  }

  /** Listen for a specific event type */
  on(event: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  /** Check if connected */
  get connected(): boolean {
    return this.isConnected;
  }

  private emit(event: string, data: any): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (e) {
        console.error(`[WS] Error in handler for ${event}:`, e);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      console.log('[WS] Attempting reconnect...');
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }
}

// Singleton instance
export const liveTrackingSocket = new LiveTrackingSocket();

// Convenience hooks helper types
export type LiveLocationData = {
  type: 'shipper:location-update';
  shipperId: string;
  orderId: string;
  lat: number;
  lng: number;
  timestamp: string;
};
