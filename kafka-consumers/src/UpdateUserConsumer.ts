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
    brokers: ['localhost:9095', 'localhost:9096', 'localhost:9097']
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
    const updatedUserDocument = await sanityClient.patch(UserPayload._id).set({
        username: UserPayload.username,
        phone: UserPayload.phone,
        email: UserPayload.email,
        geoPoint: UserPayload.geoPoint,
        address: UserPayload.address,
    }).commit();

    console.log("<< document created >> :", updatedUserDocument);
    if (redisClient.isOpen) {
        await redisClient.hSet(`hashSet:user:details`, updatedUserDocument._id, JSON.stringify(updatedUserDocument));
        await redisClient.sAdd(`set:admin:id`, updatedUserDocument._id);
    }

    await nodemailerObj.sendMail({
        from: 'ecartxvstore@gmail.com',
        to: UserPayload.email,
        subject: 'USER-ACCOUNT-CREATION',
        html: `
        <div>
        <p>${UserPayload.username}, Profile has been updated successfully!<br /><br /><br /></p>
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
            groupId: 'update-user-group',
            retry: {
                restartOnFailure: async (e: Error) => true,
                retries: 10
            }
        });

        await consumer.connect();
        await consumer.subscribe({
            topic: 'user-update-topic'
        });
        consumer.run({
            eachMessage: handleMessage
        })
    } catch (e) {
        console.log("<<error >> :", e.message);
    }
}

main();