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

    // Standard listener to bridge the emitter to this specific HTTP response
    const onNotification = (data: any) => {
        // If sellerId is provided in query, only send relevant messages
        if (sellerId && data.payload.sellerId !== sellerId) {
            console.log(`<< SSE Seller ID mismatch - skipping message >>`);
            return;
        }

        console.log(`<< SSE Sending notification to client for seller: ${sellerId || 'all'} >>`);
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

        await consumer.connect();
        await consumer.subscribe({ topic: 'subscription-notifications', fromBeginning: false });

        await consumer.run({
            eachMessage: async ({ topic, message }) => {

                if (message.value) {
                    try {
                        const rawValue = message.value.toString();

                        const payload = JSON.parse(rawValue);
                        console.log('[KAFKA] Parsed payload:', JSON.stringify(payload, null, 2));
                        // Emit to the internal emitter
                        const eventData = { topic, payload };
                        notificationEmitter.emit('notification', eventData);
                    } catch (e) {
                        console.error('[KAFKA] Error parsing Kafka message:', e);
                        console.error('[KAFKA] Raw value that failed:', message.value.toString());
                    }
                }
            },
        });
        console.log('[KAFKA] Consumer is running and waiting for messages...');
    } catch (error) {
        console.error('[KAFKA] Error in Kafka consumer:', error);
    }
};

app.listen(PORT, () => {
    console.log(`SSE Server running on http://localhost:${PORT}`);
    initKafka();
});
