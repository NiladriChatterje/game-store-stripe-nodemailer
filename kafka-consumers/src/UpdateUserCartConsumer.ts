import { Consumer, EachMessagePayload, Kafka } from 'kafkajs';
import { createClient as SanityClient } from '@sanity/client';
import { createClient as RedisClient } from 'redis';
import dotenv from 'dotenv';
import { sanityConfig } from './utils';
import { uuidv4 } from 'uuidv7';


const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});

const sanityClient = SanityClient(sanityConfig);
const redis = RedisClient({
    url: "redis://redis_storage:6379"
});

async function handleMessages({ partition, message, heartbeat }: EachMessagePayload) {
    const UserCartPayload: { _id: string; cart: any[] } = JSON.parse(message.value.toString());
    const firstRedisCheck = (await redis.hGet('user:user-cart', UserCartPayload._id)) as string;
    let userCartDocument = firstRedisCheck;
    if (firstRedisCheck == null)
        userCartDocument = await sanityClient.fetch(`*[_type=="user_cart" && user_id=="${UserCartPayload._id}"][0]{_id}`);

    let afterCreation;
    if (userCartDocument != null) {
        await redis.hSet('user:user-cart', UserCartPayload._id, userCartDocument)
        afterCreation = await sanityClient.patch(userCartDocument).set({
            cart: UserCartPayload.cart.map(item => ({
                product_reference: {
                    _ref: item._id,
                    _type: 'reference'
                }, _key: uuidv4(), cart_quantity: item.quantity
            }))
        }).commit()
    } else {
        afterCreation = await sanityClient.create({
            user_id: UserCartPayload._id,
            cart: UserCartPayload.cart.map(item => ({
                product_reference: {
                    _ref: item._id,
                    _type: 'reference'
                }, _key: uuidv4(), cart_quantity: item.quantity
            })),
            _type: "user_cart"
        })
    }

    if (redis.isOpen)
        await redis.hSet(`hashSet:user:cart`, afterCreation?._id, JSON.stringify(afterCreation?.cart))


}
async function main() {
    try {
        await redis.connect();
    } catch (e: any) {
        console.log(e.message)
    }

    const consumer: Consumer = kafka.consumer({
        groupId: 'user-cart-update',
        retry: {
            restartOnFailure: async (e: Error) => true,
            retries: 5
        },
    });

    await consumer.connect();
    await consumer.subscribe({ topic: 'update-user-cart-topic' });

    consumer.run({
        eachMessage: handleMessages
    })

}

main().catch(console.error);