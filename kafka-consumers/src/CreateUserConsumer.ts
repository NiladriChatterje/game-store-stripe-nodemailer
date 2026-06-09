import { UserType } from "@declaration/UserType";
import { EachMessagePayload, Kafka, Consumer } from "kafkajs";
import { createClient as RedisClient } from 'redis';
import { GLOBAL_DB_CONFIG } from "./utils/ShardRouter";
import nodemailer from 'nodemailer'
import dotenv from 'dotenv';
import { uuidv4 } from "uuidv7";
import mysql from 'mysql2/promise';
dotenv.config();

const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ['kafka1:9092', 'kafka2:9093', 'kafka3:9094']
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
    socket: {
        host: 'redis_storage',
        port: 6379
    }
});
async function handleMessage({ partition, topic, message, heartbeat }: EachMessagePayload) {
    const UserPayload: UserType = JSON.parse(message.value.toString());
    console.log("<< user data >> :", UserPayload)

    // Insert or update user in MySQL
    await pool.execute(
        `INSERT INTO users (id, username, phone, email, geo_lat, geo_lng, address_pincode, address_county, address_country, address_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           username = VALUES(username),
           phone = VALUES(phone),
           email = VALUES(email),
           geo_lat = VALUES(geo_lat),
           geo_lng = VALUES(geo_lng),
           address_pincode = VALUES(address_pincode),
           address_county = VALUES(address_county),
           address_country = VALUES(address_country),
           address_state = VALUES(address_state)`,
        [
            UserPayload._id,
            UserPayload.username,
            UserPayload.phone || null,
            UserPayload.email,
            UserPayload.geoPoint?.lat ?? null,
            UserPayload.geoPoint?.lng ?? null,
            UserPayload.address?.pincode ?? null,
            UserPayload.address?.county ?? null,
            UserPayload.address?.country ?? null,
            UserPayload.address?.state ?? null
        ]
    );
    console.log("<< user created/updated in MySQL >>");

    // Handle cart if present
    if (UserPayload.cart && UserPayload.cart.length > 0) {
        const [existingCart] = await pool.execute(
            'SELECT id FROM user_carts WHERE user_id = ?',
            [UserPayload._id]
        );
        let cartId: string;
        if ((existingCart as any[]).length > 0) {
            cartId = (existingCart as any[])[0].id;
            await pool.execute('DELETE FROM user_cart_items WHERE cart_id = ?', [cartId]);
        } else {
            cartId = uuidv4();
            await pool.execute(
                'INSERT INTO user_carts (id, user_id) VALUES (?, ?)',
                [cartId, UserPayload._id]
            );
        }
        for (const item of UserPayload.cart) {
            if (item._id && item.quantity) {
                await pool.execute(
                    'INSERT INTO user_cart_items (id, cart_id, product_id, quantity) VALUES (?, ?, ?, ?)',
                    [uuidv4(), cartId, item._id, item.quantity]
                );
            }
        }
        console.log("<< user cart updated in MySQL >>");
    }

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
        await redisClient.hSet(`hashSet:user:cart`, UserPayload._id, JSON.stringify(UserPayload.cart));
        console.log("<< Redis updated for user >>");
    }

    // Send email notification
    try {
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
}

main().catch(console.error);