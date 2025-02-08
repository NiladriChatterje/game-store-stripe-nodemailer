import cluster from 'node:cluster';
import { EachMessagePayload, Kafka, logLevel, } from 'kafkajs';
import { availableParallelism } from 'node:os';
import { createClient, SanityClient } from '@sanity/client';

const sanityConfig = {
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: 'production',
    apiVersion: '2024-12-21',
    useCdn: true,
    token: process.env.SANITY_TOKEN
}

const kafka: Kafka = new Kafka({
    clientId: 'xvstore',
    brokers: ['localhost:9092', 'localhost:9093']
});

if (cluster.isPrimary) {
    let i = 0;
    while (i < availableParallelism()) {
        cluster.fork();
        cluster.on('exit', () => {
            cluster.fork();
        })
    }
}
else {
    const sanityClient: SanityClient = createClient(sanityConfig)
    const consumer = kafka.consumer({
        groupId: 'product-from-admin'
    });

    async function handleMessage({ topic, partition, heartbeat, pause, message }: EachMessagePayload) {

    }

    consumer.run({
        eachMessage: handleMessage
    })
}