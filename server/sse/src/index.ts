import express, { Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import { initWebSocketServer, shutdownWebSocket } from './websocket';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Create HTTP server explicitly so we can attach WebSocket to it
const server = http.createServer(app);

// Event Emitter to bridge Kafka and SSE
const notificationEmitter1 = new EventEmitter();
const notificationEmitter2 = new EventEmitter();
const notificationEmitter3 = new EventEmitter(); // shipper events (assignments, status updates)
const notificationEmitter4 = new EventEmitter(); // shipper notification events (new deliveries)

// Increase max listeners to avoid memory leak warnings with many SSE connections
notificationEmitter1.setMaxListeners(100);
notificationEmitter2.setMaxListeners(100);
notificationEmitter3.setMaxListeners(100);
notificationEmitter4.setMaxListeners(100);

// Kafka Setup
const KAFKA_BROKERS = ["kafka1:9092", "kafka2:9093", "kafka3:9094"];

const kafka = new Kafka({
    clientId: 'sse-service',
    brokers: KAFKA_BROKERS,
});

const consumer = kafka.consumer({ groupId: `sse-group-${Math.random().toString(36).substring(7)}` });

// SSE endpoint for dashboard events (subscriptions, etc.)
app.get('/events', (req: Request<{}, {}, {}, { sellerId?: string }>, res: Response) => {
    const sellerId = req.query.sellerId as string;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const onNotification = (data: any) => {
        if (sellerId && data.payload.sellerId !== sellerId) return;
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    notificationEmitter1.on('notification', onNotification);
    res.write('data: {"message": "connected"}\n\n');

    req.on('close', () => {
        notificationEmitter1.removeListener('notification', onNotification);
    });
});

// SSE endpoint for order real-time updates
app.get('/orders', (req: Request<{}, {}, {}, { sellerId?: string }>, res: Response) => {
    const sellerId = req.query.sellerId as string;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const onOrderNotification = (data: any) => {
        // Filter by sellerId if provided
        if (sellerId && data.payload.sellerId !== sellerId) return;
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    notificationEmitter2.on('notification', onOrderNotification);
    res.write('data: {"message": "connected"}\n\n');

    req.on('close', () => {
        notificationEmitter2.removeListener('notification', onOrderNotification);
    });
});

// SSE endpoint for shipper real-time notifications (new deliveries via bell icon)
app.get('/shipper-notifications', (req: Request<{}, {}, {}, { shipperId?: string }>, res: Response) => {
    const shipperId = req.query.shipperId as string;

    if (!shipperId) {
        res.status(400).json({ error: 'shipperId query parameter is required' });
        return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const onShipperNotification = (data: any) => {
        // Forward notifications only for this shipper
        const notification = data.payload?.notification || data.payload;
        const shipperIds = data.payload?.shipperIds || [];

        if (shipperIds.includes(shipperId) || notification?.shipperId === shipperId) {
            res.write(`data: ${JSON.stringify({
                type: 'new_notification',
                data: notification
            })}\n\n`);
        }
    };

    notificationEmitter4.on('notification', onShipperNotification);
    res.write('data: {"message": "connected"}\n\n');

    req.on('close', () => {
        notificationEmitter4.removeListener('notification', onShipperNotification);
    });
});

// SSE endpoint for shipper real-time events (assignments, status updates)
app.get('/shipper-events', (req: Request<{}, {}, {}, { sellerId?: string }>, res: Response) => {
    const sellerId = req.query.sellerId as string;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const onShipperNotification = (data: any) => {
        if (sellerId && data.payload.sellerId !== sellerId) return;
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    notificationEmitter3.on('notification', onShipperNotification);
    res.write('data: {"message": "connected"}\n\n');

    req.on('close', () => {
        notificationEmitter3.removeListener('notification', onShipperNotification);
    });
});

const initKafka = async () => {
    try {
        await consumer.connect();

        // Subscribe to multiple topics
        await consumer.subscribe({ topics: ['subscription-notifications', 'order-notifications', 'seller-order-notification-topic', 'shipper-assignment-topic', 'shipping-event-topic', 'shipper-notification-topic'], fromBeginning: false });

        await consumer.run({
            eachMessage: async ({ topic, message }) => {
                if (message.value) {
                    try {
                        const payload = JSON.parse(message.value.toString());
                        console.log(`[KAFKA] message received on topic: ${topic}`);

                        const eventData = { topic, payload };

                        if (topic === 'subscription-notifications') {
                            notificationEmitter1.emit('notification', eventData);
                        } else if (topic === 'order-notifications' || topic === 'seller-order-notification-topic') {
                            notificationEmitter2.emit('notification', eventData);
                        } else if (topic === 'shipper-assignment-topic' || topic === 'shipping-event-topic') {
                            notificationEmitter3.emit('notification', eventData);
                        } else if (topic === 'shipper-notification-topic') {
                            notificationEmitter4.emit('notification', eventData);
                        }
                    } catch (e) {
                        console.error('[KAFKA] Error parsing Kafka message:', e);
                    }
                }
            },
        });
        console.log('[KAFKA] Consumer is running and waiting for messages...');
    } catch (error) {
        console.error('[KAFKA] Error in Kafka consumer:', error);
    }
};

// Graceful shutdown: disconnect Kafka consumer + WebSocket + Redis
async function gracefulShutdown(signal: string) {
    console.log(`[SSE] ${signal} received. Shutting down gracefully...`);
    try {
        await consumer.disconnect();
        console.log('[SSE] Kafka consumer disconnected.');
    } catch (e) {
        console.error('[SSE] Error disconnecting Kafka consumer:', e);
    }
    try {
        await shutdownWebSocket();
        console.log('[SSE] WebSocket / Redis disconnected.');
    } catch (e) {
        console.error('[SSE] Error shutting down WebSocket:', e);
    }
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

server.listen(PORT, () => {
    console.log(`SSE Server running on http://localhost:${PORT}`);
    // Initialise WebSocket server after HTTP server is listening
    initWebSocketServer(server).catch(err =>
        console.error('[SSE] Failed to start WebSocket server:', err)
    );
    initKafka();
});