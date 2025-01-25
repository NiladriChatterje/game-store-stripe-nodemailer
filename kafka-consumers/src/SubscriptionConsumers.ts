import { EachMessagePayload, Kafka } from 'kafkajs';
import { availableParallelism } from 'node:os';
import { createClient, SanityClient } from '@sanity/client';
import dotenv from 'dotenv';
dotenv.config();

const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ['localhost:9092', 'localhost:9093']
});

const sanityConfig = {
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: 'production',
    apiVersion: '2024-12-21',
    useCdn: true,
    token: process.env.SANITY_TOKEN
}

const sanityClient: SanityClient = createClient(sanityConfig);

async function init() {
    const consumers = [];
    for (let i = 0; i < availableParallelism(); i++)
        consumers.push(kafka.consumer({
            groupId: 'subscription-transaction',
        }));

    async function handleMessage({ partition, message, topic }: EachMessagePayload) {
        const { admin, plan } = JSON.parse(message.value.toString())
        sanityClient.patch(plan?.document_id).insert('after', 'subscriptionPlan', [])//need to check documentation
    }

    for (let consumer of consumers)
        consumer.connect().then(() => {
            consumer.subscribe({ topic: 'admin-subscription-transaction' }).then(() => {
                consumer.run({
                    eachMessage: handleMessage
                })
            })
        })

}