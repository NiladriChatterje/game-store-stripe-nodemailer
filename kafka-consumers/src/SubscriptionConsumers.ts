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

async function init() {
    const consumer = kafka.consumer({
        groupId: 'seller-subscription-transaction',
    });

    const pool = mysql.createPool(GLOBAL_DB_CONFIG);

    // Initialize Redis client
    const redisClient = createClient({
        url: 'redis://redis_storage:6379'
    });

    redisClient.on('error', (err) => console.error('Redis Client Error:', err));
    await redisClient.connect();
    console.log('Redis client connected');

    const producer = kafka.producer();

    async function handleMessage({ message }: EachMessagePayload) {
        try {
            const payload = message.value ? JSON.parse(message.value.toString()) : null;
            console.log('RECV: [SubscriptionConsumers] message received on admin-subscriptions-topic');
            let { _id, subscriptionPlan } = payload;

            if (!_id || !subscriptionPlan) {
                console.log('Skipping message: missing _id or subscriptionPlan');
                return;
            }

            // Ensure _id is prefixed correctly
            if (!_id.startsWith('seller-')) {
                _id = `seller-${_id}`;
            }

            console.log('Processing subscription for seller:', _id);

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

            console.log(`Successfully added subscription to MySQL for seller: ${_id}`);

            // 4. Store subscription details in Redis hash
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
            const EXPIRY_SECONDS = Math.ceil(expiryDurationMs / 1000); // Convert to seconds
            await redisClient.expire(REDIS_KEY, EXPIRY_SECONDS);

            // 5. Notify via Kafka for SSE
            const notificationPayload = { sellerId: _id, status: 'success' };
            await producer.connect();
            await producer.send({
                topic: 'subscription-notifications',
                messages: [{ value: JSON.stringify(notificationPayload) }]
            });
            await producer.disconnect();

        } catch (error) {
            console.error('Error processing subscription message:', error);
        }
    }

    await consumer.connect();
    // Subscribing to admin-subscriptions-topic as per current structure, 
    // but the payment service also sends here.
    await consumer.subscribe({ topic: 'admin-subscriptions-topic' });

    await consumer.run({
        eachMessage: handleMessage
    });
}

init().catch(console.error);