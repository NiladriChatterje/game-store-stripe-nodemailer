import { Consumer, EachMessagePayload, Kafka } from 'kafkajs';
import { createClient as RedisClient } from 'redis';
import dotenv from 'dotenv';
import { uuidv4 } from 'uuidv7';
import mysql from 'mysql2/promise';
import { GLOBAL_DB_CONFIG } from './utils/ShardRouter';


const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});

const pool = mysql.createPool({
    ...GLOBAL_DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 3,
    queueLimit: 10
});

const redis = RedisClient({
    url: "redis://redis_storage:6379"
});

async function handleMessages({ partition, message, heartbeat }: EachMessagePayload) {
    const UserCartPayload: { _id: string; cart: Array<{ _id: string; quantity: number }> } = JSON.parse(message.value.toString());

    // Find or create cart in MySQL
    const [existingCart] = await pool.execute(
        'SELECT id FROM user_carts WHERE user_id = ?',
        [UserCartPayload._id]
    );

    let cartId: string;
    if ((existingCart as any[]).length > 0) {
        cartId = (existingCart as any[])[0].id;
        // Delete old cart items
        await pool.execute('DELETE FROM user_cart_items WHERE cart_id = ?', [cartId]);
    } else {
        cartId = uuidv4();
        await pool.execute(
            'INSERT INTO user_carts (id, user_id) VALUES (?, ?)',
            [cartId, UserCartPayload._id]
        );
    }

    // Insert new cart items
    for (const item of UserCartPayload.cart) {
        if (item._id && item.quantity != null) {
            await pool.execute(
                'INSERT INTO user_cart_items (id, cart_id, product_id, quantity) VALUES (?, ?, ?, ?)',
                [uuidv4(), cartId, item._id, item.quantity]
            );
        }
    }

    console.log("<< user cart updated in MySQL >>");

    // Cache in Redis
    if (redis.isOpen) {
        const cartData = UserCartPayload.cart.map(item => ({
            _id: item._id,
            quantity: item.quantity
        }));
        await redis.hSet(`hashSet:user:cart`, UserCartPayload._id, JSON.stringify(cartData));
        console.log("<< Redis cart cache updated >>");
    }
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