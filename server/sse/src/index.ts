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
const KAFKA_BROKERS = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ["localhost:9095", "localhost:9096", "localhost:9097"];

const kafka = new Kafka({
    clientId: 'sse-service',
    brokers: KAFKA_BROKERS,
});

// Using a unique group ID per instance ensures all instances receive the notification
// This is critical for scaling when multiple SSE server instances might be running.
const consumer = kafka.consumer({ groupId: `sse-group-${Math.random().toString(36).substring(7)}` });

// SSE endpoint
app.get('/events', (req: Request<{}, {}, {}, { sellerId?: string }>, res: Response) => {
    const sellerId = req.query.sellerId as string;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log(`Client connected ${sellerId ? `for seller: ${sellerId}` : '(broadcasting all)'}`);

    // Standard listener to bridge the emitter to this specific HTTP response
    const onNotification = (data: any) => {
        // If sellerId is provided in query, only send relevant messages
        if (sellerId && data.payload.sellerId !== sellerId) {
            return;
        }
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    notificationEmitter.on('notification', onNotification);

    // Keep connection alive initialization
    res.write('data: {"message": "connected"}\n\n');

    req.on('close', () => {
        console.log(`Client disconnected ${sellerId ? `for seller: ${sellerId}` : ''}`);
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
                        const payload = JSON.parse(message.value.toString());
                        console.log(`Received notification for: ${payload.sellerId}`);
                        // Emit to the internal emitter
                        notificationEmitter.emit('notification', { topic, payload });
                    } catch (e) {
                        console.error('Error parsing Kafka message:', e);
                    }
                }
            },
        });
    } catch (error) {
        console.error('Error in Kafka consumer:', error);
    }
};

app.listen(PORT, () => {
    console.log(`SSE Server running on http://localhost:${PORT}`);
    initKafka();
});
