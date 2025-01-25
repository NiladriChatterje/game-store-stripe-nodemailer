import { Kafka } from 'kafkajs';
import { availableParallelism } from 'node:os';

const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ['localhost:9092', 'localhost:9093']
});

async function init() {
    const consumers = [];
    for (let i = 0; i < availableParallelism(); i++)
        consumers.push(kafka.consumer({
            groupId: 'subscription-transaction',
        }));

    for (let consumer of consumers)
        consumer.connect().then(async () => {
            await consumer.subscribe({ topic: 'admin-subscription-transaction' })
        })

    for (let consumer of consumers) {

    }
}