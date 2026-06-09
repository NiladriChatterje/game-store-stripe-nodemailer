import { UserType } from "@declaration/UserType";
import { EachMessagePayload, Kafka, Consumer } from "kafkajs";
import { createClient as RedisClient } from 'redis';
import { GLOBAL_DB_CONFIG } from "./utils/ShardRouter";
import nodemailer from 'nodemailer'
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
dotenv.config();

const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});
const nodemailerObj = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.AUTH_EMAIL,
        pass: process.env.APP_KEY,
    }
});

const pool = mysql.createPool({
    ...GLOBAL_DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 10
});

const redisClient = RedisClient({
    url: 'redis://redis_storage:6379'
});
async function handleMessage({ partition, topic, message, heartbeat }: EachMessagePayload) {
    const UserPayload: UserType = JSON.parse(message.value.toString());
    console.log("<< user data >> :", UserPayload)

    // Update user in MySQL
    await pool.execute(
        `UPDATE users SET
           username = ?,
           phone = ?,
           email = ?,
           geo_lat = ?,
           geo_lng = ?,
           address_pincode = ?,
           address_county = ?,
           address_country = ?,
           address_state = ?
         WHERE id = ?`,
        [
            UserPayload.username,
            UserPayload.phone || null,
            UserPayload.email,
            UserPayload.geoPoint?.lat ?? null,
            UserPayload.geoPoint?.lng ?? null,
            UserPayload.address?.pincode ?? null,
            UserPayload.address?.county ?? null,
            UserPayload.address?.country ?? null,
            UserPayload.address?.state ?? null,
            UserPayload._id
        ]
    );
    console.log("<< user updated in MySQL >>");

    // Cache in Redis
    if (redisClient.isOpen) {
        const redisUserData = {
            _id: UserPayload._id,
            username: UserPayload.username,
            email: UserPayload.email,
            phone: UserPayload.phone,
            geoPoint: UserPayload.geoPoint,
            address: UserPayload.address
        };
        await redisClient.hSet(`hashSet:user:details`, UserPayload._id, JSON.stringify(redisUserData));
        console.log("<< Redis updated for user >>");
    }

    // Send email notification
    try {
        await nodemailerObj.sendMail({
            from: 'ecartxvstore@gmail.com',
            to: UserPayload.email,
            subject: 'USER-PROFILE-UPDATE',
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
    } catch (emailErr) {
        console.error("Failed to send email:", emailErr);
    }
}
async function main() {
    try {
        await redisClient.connect();
    } catch (e) {
        console.log("<<redis connection failed>>", (e as Error)?.message);
    }

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
}

main().catch(console.error);