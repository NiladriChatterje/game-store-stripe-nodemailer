import { UserType } from "@declaration/UserType";
import { EachMessagePayload, Kafka, Consumer } from "kafkajs";
import { createClient as RedisClient } from 'redis';
import { createClient as SanityClient } from '@sanity/client';
import { sanityConfig } from "./utils";
import nodemailer from 'nodemailer'
import dotenv from 'dotenv';
dotenv.config();

const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ['localhost:9092', 'localhost:9093', 'localhost:9094']
});
const nodemailerObj = nodemailer.createTransport({
    service: 'google',
    auth: {
        user: process.env.AUTH_EMAIL,
        pass: process.env.APP_KEY,
    }
});

const sanityClient = SanityClient(sanityConfig);
const redisClient = RedisClient();

const consumer: Consumer = kafka.consumer({
    groupId: 'user-data-creation-consumer',
    retry: {
        restartOnFailure: async (e: Error) => Promise.resolve(true),
        retries: 15
    }
});
async function handleMessage({ partition, topic, message, heartbeat }: EachMessagePayload) {
    const UserPayload: UserType = JSON.parse(message.value.toString());

    const createdUserDocument = await sanityClient.createIfNotExists({
        _id: UserPayload._id,
        _type: 'user',
        username: UserPayload.username,
        phone: UserPayload.phone,
        email: UserPayload.email,
        geoPoint: UserPayload.geoPoint,
        address: UserPayload.address,
        cart: UserPayload.cart
    });

    console.log("<< document created >> :", createdUserDocument);
    if (redisClient.isOpen) {
        await redisClient.hSet(`hashSet:user:details`, createdUserDocument._id, JSON.stringify(createdUserDocument));
        await redisClient.sadd(`set:admin:id`, createdUserDocument.username);
    }

    nodemailerObj.sendMail({
        from: 'ecartxvstore@gmail.com',
        to: UserPayload.email,
        subject: 'USER-ACCOUNT-CREATION',
        text: `${UserPayload.username}, your user account has been created successfully.\n
        Enjoy shopping in our website.\n
        ${UserPayload.phone ? '' : 'Add your phone number so that we can reach you out whenever you want our assistance.'}
        `
    })
}
async function main() {
    try {
        await redisClient.connect();
        const consumer: Consumer = kafka.consumer({
            groupId: 'create-user-group',
            retry: {
                restartOnFailure: async (e: Error) => true,
                retries: 10
            }
        });

        await consumer.connect();
        await consumer.subscribe({
            topic: 'user-create-topic'
        });
        consumer.run({
            eachMessage: handleMessage
        })
    } catch (e) {
        console.log("<<error >> :", e.message);
    }
}

main();