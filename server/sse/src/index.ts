import express, { Request, Response } from 'express';
import cors from 'cors';
import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Event Emitter to bridge Kafka and SSE
const notificationEmitter1 = new EventEmitter();
const notificationEmitter2 = new EventEmitter();

// Increase max listeners to avoid memory leak warnings with many SSE connections
notificationEmitter1.setMaxListeners(100);
notificationEmitter2.setMaxListeners(100);

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

const initKafka = async () => {
    try {
        await consumer.connect();

        // Subscribe to multiple topics
        await consumer.subscribe({ topics: ['subscription-notifications', 'order-notifications', 'seller-order-notification-topic'], fromBeginning: false });

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

// Graceful shutdown: disconnect Kafka consumer
process.on('SIGTERM', async () => {
    console.log('[SSE] SIGTERM received. Shutting down gracefully...');
    try {
        await consumer.disconnect();
        console.log('[SSE] Kafka consumer disconnected.');
    } catch (e) {
        console.error('[SSE] Error disconnecting Kafka consumer:', e);
    }
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[SSE] SIGINT received. Shutting down gracefully...');
    try {
        await consumer.disconnect();
        console.log('[SSE] Kafka consumer disconnected.');
    } catch (e) {
        console.error('[SSE] Error disconnecting Kafka consumer:', e);
    }
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`SSE Server running on http://localhost:${PORT}`);
    initKafka();
});