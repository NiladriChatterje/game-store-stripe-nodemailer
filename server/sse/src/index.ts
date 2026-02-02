import express, { Request, Response } from 'express';
import cors from 'cors';
import { Kafka } from 'kafkajs';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// List of connected SSE clients
let clients: { id: string; response: Response }[] = [];

// SSE endpoint
app.get('/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const clientId = Date.now().toString();
    const newClient = { id: clientId, response: res };
    clients.push(newClient);

    console.log(`Client ${clientId} connected`);

    // Keep connection alive
    res.write('data: {"message": "connected"}\n\n');

    req.on('close', () => {
        console.log(`Client ${clientId} disconnected`);
        clients = clients.filter(client => client.id !== clientId);
    });
});

// Broadcast function
const broadcast = (data: any) => {
    clients.forEach(client => {
        client.response.write(`data: ${JSON.stringify(data)}\n\n`);
    });
};

// Kafka Setup
const kafka = new Kafka({
    clientId: 'sse-service',
    brokers: ["localhost:9095", "localhost:9096", "localhost:9097"],
});

const consumer = kafka.consumer({ groupId: 'sse-group' });

const initKafka = async () => {
    try {
        await consumer.connect();
        await consumer.subscribe({ topic: 'subscription-notifications', fromBeginning: false });

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                if (message.value) {
                    const payload = JSON.parse(message.value.toString());
                    console.log('Received Kafka message:', payload);
                    broadcast({ topic, payload });
                }
            },
        });
        console.log('Kafka Consumer connected and subscribed to subscription-notifications');
    } catch (error) {
        console.error('Error in Kafka consumer:', error);
    }
};

app.listen(PORT, () => {
    console.log(`SSE Server running on http://localhost:${PORT}`);
    initKafka();
});
