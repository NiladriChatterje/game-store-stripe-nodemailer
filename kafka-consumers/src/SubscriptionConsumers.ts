import { EachMessagePayload, Kafka } from 'kafkajs';
import { availableParallelism } from 'node:os';
import { createClient, SanityClient } from '@sanity/client';
import dotenv from 'dotenv';
import shortid from 'shortid';
dotenv.config();

const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ['localhost:9095', 'localhost:9096', 'localhost:9097'],
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
            groupId: 'seller-subscription-transaction',
        }));

    async function handleMessage({ message }: EachMessagePayload) {
        const { _id, subscriptionPlan } = JSON.parse(message.value.toString())
        console.log(subscriptionPlan)
        sanityClient.patch(_id).append('subscriptionPlan', [{
            _key: shortid(),
            ...subscriptionPlan
        }])
            .commit()//need to check documentation
    }

    for (let consumer of consumers)
        consumer.connect().then(() => {
            consumer.subscribe({ topic: 'admin-update-topic' }).then(() => {
                consumer.run({
                    eachMessage: handleMessage
                })
            })
        })

}

init();