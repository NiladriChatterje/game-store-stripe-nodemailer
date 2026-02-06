import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { createClient, SanityClient } from "@sanity/client";
import axios from 'axios';
import { sanityConfig } from "@utils";

const kafka: Kafka = new Kafka({
    clientId: "xvstore-refund",
    brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});

async function main() {
    const sanityClient: SanityClient = createClient({
        ...sanityConfig,
        perspective: "published",
    });

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
            } = JSON.parse(message.value.toString());

            console.log('Processing refund:', {
                orderId: refundPayload.orderId,
                amount: refundPayload.refundAmount,
                reason: refundPayload.reason
            });

            // ✅ Step 1: Call payment service to process refund
            try {
                const refundResponse = await axios.post(
                    `${process.env.PAYMENT_SERVICE_URL || 'http://localhost:5000'}/process-refund`,
                    {
                        orderId: refundPayload.orderId,
                        transactionId: refundPayload.transactionId,
                        refundAmount: refundPayload.refundAmount,
                        reason: refundPayload.reason,
                        customerEmail: refundPayload.customerEmail
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                console.log('Refund processed via payment service:', refundResponse.data);

                // ✅ Step 2: Update order document with refund success
                await sanityClient.patch(refundPayload.orderId)
                    .set({
                        refundStatus: 'completed',
                        razorpayRefundId: refundResponse.data.refundData?.refundId,
                        refundProcessedAt: new Date().toISOString()
                    })
                    .commit();

                console.log('Order refund status updated to completed:', {
                    orderId: refundPayload.orderId,
                    refundId: refundResponse.data.refundData?.refundId
                });

                // ✅ Step 3: Log refund in audit trail
                await sanityClient.create({
                    _type: 'refundAudit',
                    order: { _ref: refundPayload.orderId },
                    customer: { _ref: refundPayload.customerId },
                    originalAmount: refundPayload.originalAmount,
                    fulfilledAmount: refundPayload.fulfilledAmount,
                    refundAmount: refundPayload.refundAmount,
                    reason: refundPayload.reason,
                    razorpayRefundId: refundResponse.data.refundData?.refundId,
                    status: 'completed',
                    processedAt: new Date().toISOString(),
                    notes: `Partial fulfillment refund: ${refundPayload.fulfilledQuantity}/${refundPayload.requestedQuantity} units fulfilled`
                });

                console.log('Refund audit logged successfully');

            } catch (paymentServiceError: any) {
                console.error('Payment service refund error:', {
                    orderId: refundPayload.orderId,
                    error: paymentServiceError?.message,
                    response: paymentServiceError?.response?.data
                });

                // Update order with refund failure
                await sanityClient.patch(refundPayload.orderId)
                    .set({
                        refundStatus: 'failed',
                        refundErrorMessage: paymentServiceError?.response?.data?.error?.message || paymentServiceError?.message,
                        refundRetryCount: 1
                    })
                    .commit();

                console.log('Order refund status updated to failed');

                // Log failed refund attempt
                await sanityClient.create({
                    _type: 'refundAudit',
                    order: { _ref: refundPayload.orderId },
                    customer: { _ref: refundPayload.customerId },
                    refundAmount: refundPayload.refundAmount,
                    reason: refundPayload.reason,
                    status: 'failed',
                    errorMessage: paymentServiceError?.response?.data?.error?.message || paymentServiceError?.message,
                    processedAt: new Date().toISOString(),
                    notes: 'Refund processing failed - will retry'
                });

                throw paymentServiceError;
            }

            consumer.commitOffsets([
                { topic, partition, offset: message.offset },
            ]);

            console.log('Refund message committed successfully');

        } catch (error: Error | any) {
            console.error('Failed to process refund message:', {
                error: error?.message,
                stack: error?.stack,
                payload: message.value.toString()
            });

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
