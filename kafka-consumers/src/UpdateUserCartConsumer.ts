import { Consumer, EachMessagePayload, Kafka } from 'kafkajs';
import { createClient as SanityClient } from '@sanity/client';
import { createClient as RedisClient } from 'redis';
import dotenv from 'dotenv';
import { sanityConfig } from './utils';


const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ['localhost:9092', 'localhost:9093', 'localhost:9094']
});

const sanityClient = SanityClient(sanityConfig);
const redis = RedisClient();

async function handleMessages({ partition, message, heartbeat }: EachMessagePayload) {
    const result = await sanityClient.fetch<any>(`*[_type=="user_cart" && user_id=="${message}"]`)
}
async function main() {
    try {
        await redis.connect();
    } catch (e) {
        console.log(e.message)
    }

    const consumer: Consumer = kafka.consumer({
        groupId: 'user-cart-update',
        retry: {
            restartOnFailure: async (e: Error) => true,
            retries: 5
        },
    });

    consumer.run({
        eachMessage: handleMessages
    })

}