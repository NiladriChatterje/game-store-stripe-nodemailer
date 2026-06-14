import { WebSocketServer, WebSocket } from 'ws';
import { createClient } from 'redis';
import http from 'http';

// ─────────────────────────────────────────────────────
// In‑memory subscription registry
// ─────────────────────────────────────────────────────

/** Map of orderId → set of user WebSocket clients watching that order */
const orderSubscribers = new Map<string, Set<WebSocket>>();

// ─────────────────────────────────────────────────────
// Redis pub/sub
// ─────────────────────────────────────────────────────

const REDIS_CHANNEL = 'shipper:live-location';

let pubClient!: ReturnType<typeof createClient>;
let subClient!: ReturnType<typeof createClient>;

async function connectRedis(): Promise<void> {
  pubClient = createClient({ url: 'redis://redis_storage:6379' });
  subClient = pubClient.duplicate();

  await pubClient.connect();
  await subClient.connect();

  await subClient.subscribe(REDIS_CHANNEL, (message) => {
    try {
      const data = JSON.parse(message);
      // Bounce the location to every user WebSocket that is watching that order
      const subscribers = orderSubscribers.get(data.orderId);
      if (!subscribers || subscribers.size === 0) return;

      const payload = JSON.stringify(data);
      for (const ws of subscribers) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }
    } catch (e) {
      console.error('[WS] Error processing Redis message:', e);
    }
  });

  console.log('[WS] Redis pub/sub connected and subscribed to', REDIS_CHANNEL);
}

// ─────────────────────────────────────────────────────
// WebSocket server initialisation
// ─────────────────────────────────────────────────────

export async function initWebSocketServer(server: http.Server): Promise<WebSocketServer> {
  await connectRedis();

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[WS] Client connected');

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          // ── Shipper registers for a delivery order ──
          case 'shipper:register': {
            // { type: 'shipper:register', shipperId: 'shipper-xxx', orderId: 'ORD-123' }
            (ws as any)._shipperId = msg.shipperId;
            (ws as any)._orderId = msg.orderId;
            console.log(`[WS] Shipper ${msg.shipperId} registered for order ${msg.orderId}`);
            break;
          }

          // ── Shipper pushes a live location update ──
          case 'shipper:location-update': {
            // { type: 'shipper:location-update', shipperId, orderId, lat, lng }
            const payload = {
              type: 'shipper:location-update',
              shipperId: msg.shipperId,
              orderId: msg.orderId,
              lat: msg.lat,
              lng: msg.lng,
              timestamp: new Date().toISOString(),
            };
            const payloadStr = JSON.stringify(payload);

            // Publish to Redis so every SSE instance gets it
            pubClient.publish(REDIS_CHANNEL, payloadStr);

            // Also forward directly to locally-connected user subscribers
            const subscribers = orderSubscribers.get(msg.orderId);
            if (subscribers) {
              for (const client of subscribers) {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(payloadStr);
                }
              }
            }
            break;
          }

          // ── User subscribes to an order's live tracking ──
          case 'user:subscribe-order': {
            // { type: 'user:subscribe-order', orderId: 'ORD-123' }
            const orderId = msg.orderId;
            if (!orderSubscribers.has(orderId)) {
              orderSubscribers.set(orderId, new Set());
            }
            orderSubscribers.get(orderId)!.add(ws);
            (ws as any)._subscribedOrderId = orderId;
            console.log(`[WS] User subscribed to order ${orderId}`);
            break;
          }

          default:
            console.warn('[WS] Unknown message type:', msg.type);
        }
      } catch (e) {
        console.error('[WS] Error parsing message:', e);
      }
    });

    ws.on('close', () => {
      // Clean up subscriber registry
      const subscribedOrderId = (ws as any)._subscribedOrderId;
      if (subscribedOrderId) {
        const subscribers = orderSubscribers.get(subscribedOrderId);
        if (subscribers) {
          subscribers.delete(ws);
          if (subscribers.size === 0) orderSubscribers.delete(subscribedOrderId);
        }
      }
      console.log('[WS] Client disconnected');
    });

    ws.on('error', (err: Error) => {
      console.error('[WS] Client error:', err.message);
    });
  });

  console.log('[WS] WebSocket server ready on path /ws');
  return wss;
}

// ─────────────────────────────────────────────────────
// Graceful shutdown helper
// ─────────────────────────────────────────────────────

export async function shutdownWebSocket(): Promise<void> {
  try {
    if (subClient) await subClient.unsubscribe(REDIS_CHANNEL);
    if (subClient) await subClient.quit();
    if (pubClient) await pubClient.quit();
  } catch (e) {
    console.error('[WS] Error shutting down Redis:', e);
  }
}
