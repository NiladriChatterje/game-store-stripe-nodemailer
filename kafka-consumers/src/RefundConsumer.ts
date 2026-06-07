import { EachMessagePayload, Kafka } from "kafkajs";
import { uuidv7 as uuid } from "uuidv7";
import mysql from 'mysql2/promise';

const GLOBAL_DB_CONFIG = {
    host: 'global_sql_data',
    port: 3306,
    user: 'root',
    password: '',
    database: 'xvstore'
};

const kafka: Kafka = new Kafka({
    clientId: "xvstore-refund",
    brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});

const globalPool = mysql.createPool({
    ...GLOBAL_DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
});

async function main() {
    const consumer = kafka.consumer({
        groupId: "order-refund-processor",
    });

    await consumer.connect();
    await consumer.subscribe({ topic: "order-refund-topic" });

    async function handleEachMessage({
        heartbeat,
        message,
        partition,
        topic,
    }: EachMessagePayload) {
        console.log("<Refund Message Received>: ", message.value);

        try {
            const refundPayload: {
                orderId: string;
                transactionId: string;
                customerId: string;
                customerEmail: string;
                refundAmount: number;
                reason: string;
                originalAmount: number;
                fulfilledAmount: number;
                fulfilledQuantity: number;
                requestedQuantity: number;
            } = message.value ? JSON.parse(message.value.toString()) : {};

            console.log('Processing refund:', {
                orderId: refundPayload.orderId,
                amount: refundPayload.refundAmount,
                reason: refundPayload.reason
            });

            // Step 1: Call payment service to process refund
            const paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://payment_service:5000';
            const refundResponse = await fetch(`${paymentUrl}/process-refund`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    orderId: refundPayload.orderId,
                    transactionId: refundPayload.transactionId,
                    refundAmount: refundPayload.refundAmount,
                    reason: refundPayload.reason,
                    customerEmail: refundPayload.customerEmail
                })
            });

            if (!refundResponse.ok) {
                const errorBody = await refundResponse.text();
                throw new Error(`Payment service returned ${refundResponse.status}: ${errorBody}`);
            }

            const refundData = await refundResponse.json();
            console.log('Refund processed via payment service:', refundData);

            // Step 2: Update order with refund success
            await globalPool.execute(
                `UPDATE orders SET
                   refund_status = 'completed',
                   razorpay_refund_id = ?,
                   fulfilled_quantity = ?,
                   refund_amount = ?
                 WHERE id = ?`,
                [
                    refundData.refundData?.refundId || null,
                    refundPayload.fulfilledQuantity,
                    refundPayload.refundAmount,
                    refundPayload.orderId,
                ]
            );

            console.log('Order refund status updated to completed:', {
                orderId: refundPayload.orderId,
                refundId: refundData.refundData?.refundId
            });

            // Step 3: Insert refund audit trail
            await globalPool.execute(
                `INSERT INTO refund_audits
                 (id, order_id, customer_id, original_amount, fulfilled_amount, refund_amount, reason, razorpay_refund_id, status, processed_at, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', NOW(), ?)`,
                [
                    uuid(),
                    refundPayload.orderId,
                    refundPayload.customerId,
                    refundPayload.originalAmount,
                    refundPayload.fulfilledAmount,
                    refundPayload.refundAmount,
                    refundPayload.reason,
                    refundData.refundData?.refundId || null,
                    `Partial fulfillment refund: ${refundPayload.fulfilledQuantity}/${refundPayload.requestedQuantity} units fulfilled`,
                ]
            );

            console.log('Refund audit logged successfully');

            consumer.commitOffsets([
                { topic, partition, offset: message.offset },
            ]);

            console.log('Refund message committed successfully');

        } catch (error: Error | any) {
            console.error('Failed to process refund message:', {
                error: error?.message,
                stack: error?.stack,
                payload: message.value ? message.value.toString() : null
            });

            // On payment service failure, record the failure in orders and audit
            try {
                const refundPayload = message.value ? JSON.parse(message.value.toString()) : {};
                if (refundPayload.orderId) {
                    await globalPool.execute(
                        `UPDATE orders SET
                           refund_status = 'failed',
                           partial_fulfillment_reason = ?
                         WHERE id = ?`,
                        [error?.message || 'Refund processing failed', refundPayload.orderId]
                    );

                    await globalPool.execute(
                        `INSERT INTO refund_audits
                         (id, order_id, customer_id, original_amount, fulfilled_amount, refund_amount, reason, status, error_message, processed_at, notes)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?, NOW(), ?)`,
                        [
                            uuid(),
                            refundPayload.orderId,
                            refundPayload.customerId || '',
                            refundPayload.originalAmount || 0,
                            refundPayload.fulfilledAmount || 0,
                            refundPayload.refundAmount || 0,
                            refundPayload.reason || '',
                            error?.message || 'Unknown error',
                            'Refund processing failed - will retry',
                        ]
                    );
                }
            } catch (dbError) {
                console.error('Failed to record refund failure in database:', dbError);
            }

            // Commit offset even on error to prevent infinite retry loop
            try {
                consumer.commitOffsets([
                    { topic, partition, offset: message.offset },
                ]);
                console.log('Offset committed despite error');
            } catch (commitError) {
                console.error('Failed to commit offset after error:', commitError);
            }
        }
    }

    consumer.run({
        partitionsConsumedConcurrently: 3,
        eachMessage: handleEachMessage,
        autoCommit: false,
    });

    console.log('Refund Consumer started - listening on order-refund-topic');
}

main().catch(console.error);
