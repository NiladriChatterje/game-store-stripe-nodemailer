import { EachMessagePayload, Kafka } from 'kafkajs';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import shortid from 'shortid';
import { createClient } from 'redis';
import { GLOBAL_DB_CONFIG } from './utils/ShardRouter';

dotenv.config();

const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function init() {
    const consumer = kafka.consumer({
        groupId: 'seller-subscription-transaction',
    });

    const pool = mysql.createPool({
        ...GLOBAL_DB_CONFIG,
        waitForConnections: true,
        connectionLimit: 3,
        queueLimit: 10,
        connectTimeout: 10000
    });

    // Retry connecting to MySQL pool (global_sql_data may still be booting)
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            const conn = await pool.getConnection();
            console.log('[SubscriptionConsumers] MySQL pool connected');
            conn.release();
            break;
        } catch (err) {
            console.warn(`[SubscriptionConsumers] MySQL connection attempt ${attempt}/5 failed, retrying in 3s...`);
            if (attempt === 5) {
                console.error('[SubscriptionConsumers] Could not connect to MySQL after 5 attempts. Continuing anyway...');
            }
            await sleep(3000);
        }
    }

    // Initialize Redis client (non-blocking — consumer works without Redis)
    const redisClient = createClient({
        url: 'redis://redis_storage:6379'
    });

    let redisAvailable = false;
    redisClient.on('error', (err) => {
        console.error('[SubscriptionConsumers] Redis Client Error:', err);
        redisAvailable = false;
    });
    redisClient.on('connect', () => {
        redisAvailable = true;
        console.log('[SubscriptionConsumers] Redis client connected');
    });
    redisClient.on('end', () => {
        redisAvailable = false;
        console.warn('[SubscriptionConsumers] Redis client disconnected');
    });

    try {
        await redisClient.connect();
    } catch (err) {
        console.warn('[SubscriptionConsumers] Redis connection failed at startup — continuing without Redis cache');
        redisAvailable = false;
    }

    const producer = kafka.producer();

    async function handleMessage({ message, heartbeat }: EachMessagePayload) {
        try {
            const payload = message.value ? JSON.parse(message.value.toString()) : null;
            console.log('[SubscriptionConsumers] RECV: message on admin-subscriptions-topic');
            let { _id, username, email, subscriptionPlan } = payload;

            if (!_id || !subscriptionPlan) {
                console.log('[SubscriptionConsumers] Skipping message: missing _id or subscriptionPlan');
                return;
            }

            // Ensure _id is prefixed correctly
            if (!_id.startsWith('seller-')) {
                _id = `seller-${_id}`;
            }

            console.log('[SubscriptionConsumers] Processing subscription for seller:', _id);

            // Verify the seller exists in the sellers table (foreign key constraint check).
            // If not, create a minimal record — the CreateAdminConsumer will fill in the
            // full details later via ON DUPLICATE KEY UPDATE when it processes.
            // This avoids a race condition where the user buys a subscription before the
            // profile creation Kafka message has been consumed.
            const [sellerRows]: any = await pool.execute(
                'SELECT id FROM sellers WHERE id = ?',
                [_id]
            );

            if (!Array.isArray(sellerRows) || sellerRows.length === 0) {
                console.log(`[SubscriptionConsumers] Creating minimal seller record for ${_id} (will be enriched by CreateAdminConsumer later)`);
                const sellerUsername = username || 'Unknown';
                // Use the actual email from Clerk if available; otherwise fabricate a placeholder
                const sellerEmail = email || (
                    username
                        ? `${username?.toLowerCase().replace(/\s+/g, '.')}-${_id}@placeholder.local`
                        : `pending-${_id}@placeholder.local`
                );
                await pool.execute(
                    `INSERT INTO sellers (id, username, email, created_at, updated_at)
                     VALUES (?, ?, ?, NOW(), NOW())
                     ON DUPLICATE KEY UPDATE updated_at = NOW()`,
                    [_id, sellerUsername, sellerEmail]
                );
            }

            // 1. Get the latest expiry date for this seller
            const [rows]: any = await pool.execute(
                'SELECT MAX(plan_expire_date) as latestExpire FROM seller_subscriptions WHERE seller_id = ?',
                [_id]
            );

            let newPlanStartDate = new Date();
            const latestExpire = rows[0]?.latestExpire;

            if (latestExpire) {
                const expireDate = new Date(latestExpire);
                if (expireDate > newPlanStartDate) {
                    newPlanStartDate = expireDate;
                }
            }

            // 2. Calculate new expiry date (30 days from start)
            const newPlanExpiryDate = new Date(newPlanStartDate);
            newPlanExpiryDate.setDate(newPlanExpiryDate.getDate() + 30);

            // 3. Insert into MySQL
            await pool.execute(
                `INSERT INTO seller_subscriptions 
                (id, seller_id, transaction_id, order_id, payment_signature, amount, store_allotment, plan_active_date, plan_expire_date) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    shortid(),
                    _id,
                    subscriptionPlan.transactionId,
                    subscriptionPlan.orderId,
                    subscriptionPlan.paymentSignature,
                    subscriptionPlan.amount || 0,
                    subscriptionPlan.storeAllotment || 1,
                    newPlanStartDate,
                    newPlanExpiryDate
                ]
            );

            console.log(`[SubscriptionConsumers] ✅ Successfully added subscription to MySQL for seller: ${_id}`);

            await heartbeat();

            // 4. Store subscription details in Redis hash (only if Redis is available)
            if (redisAvailable) {
                try {
                    const REDIS_KEY = 'admin:subscription:details';
                    const subscriptionData = {
                        transactionId: subscriptionPlan.transactionId,
                        orderId: subscriptionPlan.orderId,
                        paymentSignature: subscriptionPlan.paymentSignature,
                        amount: subscriptionPlan.amount || 0,
                        storeAllotment: subscriptionPlan.storeAllotment || 1,
                        planActiveDate: newPlanStartDate.toISOString(),
                        planExpireDate: newPlanExpiryDate.toISOString(),
                        lastUpdated: new Date().toISOString()
                    };

                    await redisClient.hSet(REDIS_KEY, _id, JSON.stringify(subscriptionData));

                    // Set expiry based on subscription plan duration
                    const currentTime = new Date();
                    const expiryDurationMs = newPlanExpiryDate.getTime() - currentTime.getTime();
                    const EXPIRY_SECONDS = Math.ceil(expiryDurationMs / 1000);
                    await redisClient.expire(REDIS_KEY, EXPIRY_SECONDS);
                } catch (redisErr) {
                    console.warn('[SubscriptionConsumers] Redis write failed (cache will be built from MySQL on next fetch):', redisErr);
                }
            } else {
                console.log('[SubscriptionConsumers] Redis unavailable — skipping cache write (seller_service will read from MySQL)');
            }

            await heartbeat();

            // 5. Notify via Kafka for SSE
            const notificationPayload = { sellerId: _id, status: 'success' };
            try {
                await producer.connect();
                await producer.send({
                    topic: 'subscription-notifications',
                    messages: [{ value: JSON.stringify(notificationPayload) }]
                });
            } finally {
                await producer.disconnect().catch(() => {});
            }

            console.log(`[SubscriptionConsumers] ✅ Subscription notification sent for seller: ${_id}`);

        } catch (error) {
            console.error('[SubscriptionConsumers] Error processing subscription message:', error);
        }
    }

    await consumer.connect();
    await consumer.subscribe({ topic: 'admin-subscriptions-topic' });

    await consumer.run({
        eachMessage: handleMessage
    });
    console.log('[SubscriptionConsumers] Consumer is running, waiting for messages...');
}

init().catch((err) => {
    console.error('[SubscriptionConsumers] Fatal error in init():', err);
    process.exit(1);
});