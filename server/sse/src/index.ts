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
const notificationEmitter = new EventEmitter();

// Kafka Setup
const KAFKA_BROKERS = ["kafka1:9092", "kafka2:9093", "kafka3:9094"];

const kafka = new Kafka({
    clientId: 'sse-service',
    brokers: KAFKA_BROKERS,
});

const consumer = kafka.consumer({ groupId: `sse-group-${Math.random().toString(36).substring(7)}` });

// SSE endpoint
app.get('/events', (req: Request<{}, {}, {}, { sellerId?: string }>, res: Response) => {
    const sellerId = req.query.sellerId as string;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log(`[SSE] Client connected ${sellerId ? `for seller: ${sellerId}` : '(broadcasting all)'}`);
    console.log(`[SSE] Total active listeners: ${notificationEmitter.listenerCount('notification')}`);

    // Standard listener to bridge the emitter to this specific HTTP response
    const onNotification = (data: any) => {
        console.log(`[SSE] 📨 Notification received:`, JSON.stringify(data));
        console.log(`[SSE] 🔍 Checking sellerId - Query: ${sellerId}, Payload: ${data.payload?.sellerId}`);

        // If sellerId is provided in query, only send relevant messages
        if (sellerId && data.payload.sellerId !== sellerId) {
            console.log(`[SSE] Seller ID mismatch - skipping message`);
            return;
        }

        console.log(`[SSE] Sending notification to client for seller: ${sellerId || 'all'}`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    notificationEmitter.on('notification', onNotification);

    // Keep connection alive initialization
    res.write('data: {"message": "connected"}\n\n');

    req.on('close', () => {
        notificationEmitter.removeListener('notification', onNotification);
    });
});

const initKafka = async () => {
    try {
        console.log('[KAFKA] 🔌 Connecting to Kafka brokers:', KAFKA_BROKERS);
        await consumer.connect();
        console.log('[KAFKA] ✅ Connected to Kafka');

        await consumer.subscribe({ topic: 'subscription-notifications', fromBeginning: false });
        console.log('[KAFKA] 📡 Subscribed to topic: subscription-notifications');

        await consumer.run({
            eachMessage: async ({ topic, message }) => {
                console.log('[KAFKA] 📬 Raw message received from topic:', topic);

                if (message.value) {
                    try {
                        const rawValue = message.value.toString();
                        console.log('[KAFKA] 📄 Raw message value:', rawValue);

                        const payload = JSON.parse(rawValue);
                        console.log('[KAFKA] 📦 Parsed payload:', JSON.stringify(payload, null, 2));
                        console.log(`[KAFKA] 🎯 Notification for sellerId: ${payload.sellerId}, status: ${payload.status}`);

                        // Emit to the internal emitter
                        const eventData = { topic, payload };
                        console.log('[KAFKA] 🔔 Emitting notification event:', JSON.stringify(eventData));
                        notificationEmitter.emit('notification', eventData);
                        console.log('[KAFKA] ✅ Notification emitted successfully');
                    } catch (e) {
                        console.error('[KAFKA] ❌ Error parsing Kafka message:', e);
                        console.error('[KAFKA] Raw value that failed:', message.value.toString());
                    }
                }
            },
        });
        console.log('[KAFKA] 🏃 Consumer is running and waiting for messages...');
    } catch (error) {
        console.error('[KAFKA] ❌ Error in Kafka consumer:', error);
    }
};

app.listen(PORT, () => {
    console.log(`SSE Server running on http://localhost:${PORT}`);
    initKafka();
});
