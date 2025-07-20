import { UserType } from "@declaration/UserType";
import { EachMessagePayload, Kafka, Consumer } from "kafkajs";
import { createClient as RedisClient } from 'redis';
import { createClient as SanityClient } from '@sanity/client';
import { sanityConfig } from "./utils";
import nodemailer from 'nodemailer'
import dotenv from 'dotenv';
import { uuidv4 } from "uuidv7";
dotenv.config();

const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ['localhost:9092', 'localhost:9093', 'localhost:9094']
});
const nodemailerObj = nodemailer.createTransport({
    service: 'gmail',
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
    console.log("<< user data >> :", UserPayload)
    const createdUserDocument = await sanityClient.createIfNotExists({
        _id: UserPayload._id,
        _type: 'user',
        username: UserPayload.username,
        phone: UserPayload.phone,
        email: UserPayload.email,
        geoPoint: UserPayload.geoPoint,
        address: UserPayload.address,
        cart: UserPayload.cart.map(item => ({
            product_reference: {
                _ref: item._id,
                _type: 'reference'
            }, _key: uuidv4(), cart_quantity: item.quantity
        }))
    });

    console.log("<< document created >> :", createdUserDocument);
    if (redisClient.isOpen) {
        await redisClient.hSet(`hashSet:user:details`, createdUserDocument._id, JSON.stringify(createdUserDocument));
        await redisClient.sAdd(`set:admin:id`, createdUserDocument._id);
    }

    await nodemailerObj.sendMail({
        from: 'ecartxvstore@gmail.com',
        to: UserPayload.email,
        subject: 'USER-ACCOUNT-CREATION',
        html: `
        <div>
        <p>${UserPayload.username}, your user account has been created successfully.<br />
        Enjoy shopping in our website.<br /><br /><br /></p>
        ${UserPayload.phone ? '' :
                `<strong>Add your phone number so that we can reach you<br />
        out whenever you want our assistance.</strong>`}
            <br /><br />
            <section>
                <table cellspacing="0" cellpadding="0">
                    <tr>
                        <td style="background-color:#19283d;border-radius:5px;">
                            <a href="http://localhost:5173/" style="display:block;padding:10px 20px;color:white;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;">Go to Shop</a>
                        </td>
                    </tr>
                </table>
            </section>
        </div>
        `
    });
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