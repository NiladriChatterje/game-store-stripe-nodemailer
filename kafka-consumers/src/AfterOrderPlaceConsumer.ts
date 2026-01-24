import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { createClient, SanityClient } from "@sanity/client";
import { createClient as RedisClient } from "redis";
import type { ProductType } from "../declaration/productType.d.ts";
import { sanityConfig } from "@utils";
import { uuidv7 as uuid } from 'uuidv7'

const kafka: Kafka = new Kafka({
    clientId: "xvstore",
    brokers: ["localhost:9095", "localhost:9096", "localhost:9097"],
});


async function main() {
    const redisClient = RedisClient();
    await redisClient.connect();
    const sanityClient: SanityClient = createClient({
        ...sanityConfig,
        perspective: "published",
    });
    const consumer = kafka.consumer({
        groupId: "product-quantity-reduction",
    });

    await consumer.connect();
    await consumer.subscribe({ topic: "update-product-quantity-topic" });

    async function handleEachMessages({
        heartbeat,
        message,
        partition,
        topic,
    }: EachMessagePayload) {
        console.log("<arrayBufferLike> : ", message.value);

        try {
            const productPayload: {
                customer: string;
                customerEmail: string;
                product: string;//product_id
                transactionId: string;
                orderId: string;
                geoPoint: { lat: number; lng: number };
                pincode: number;
                paymentSignature: string;
                amount: number;
                quantity: number;
            } = JSON.parse(
                message.value.toString()
            );

            type QuantityObj = {
                _id: string;
                quantityObj?:
                { quantity: number; _key: string; _type: string, pincode: string }
            }

            const getQtyOnPincode: QuantityObj = await sanityClient.fetch(`*[_type == 'product'
                            && _id match '${productPayload.product}'][0]{
                            _id,
                            "quantityObj": quantity[pincode match "${productPayload.pincode}"][0] 
                          }`);

            if (getQtyOnPincode._id.length > 0) {
                //if record was found update the particular document in the array with extra quantity
                const result = await sanityClient
                    .patch(productPayload.product)
                    .insert('replace',
                        `quantity[pincode=="${productPayload.pincode}"]`, [{
                            pincode: productPayload.pincode,
                            quantity: productPayload.quantity - getQtyOnPincode?.quantityObj.quantity,
                            _key: uuid()
                        }]
                    )
                    .commit();

                console.log(`result after updating quantity of a pincode:`, result);

                //update the product to redis
                redisClient.hset("products:details", productPayload.product, JSON.stringify({
                    ...productPayload,
                    quantity: productPayload.quantity + (getQtyOnPincode?.quantityObj?.quantity ?? 0)
                }))
            }

            const seller_quantity = await sanityClient.fetch(`*[_type=='seller_product_details' 
                    && product_id match "${productPayload.product}"
                    && quantity >= ${productPayload.quantity}
                    ][0]{
                    ...,
                     "distance": geo::distance(geoPoint, geo::latLng(${productPayload.geoPoint.lat},
                      ${productPayload.geoPoint.lng}))
                    } | order(distance asc)[0]`);


            const result = await sanityClient
                .patch(productPayload.product)
                .insert('replace',
                    `quantity[pincode=="${productPayload.pincode}"]`, [{
                        pincode: productPayload.pincode,
                        quantity: Math.max(getQtyOnPincode?.quantityObj.quantity - productPayload.quantity, 0),
                        _key: uuid()
                    }]
                )
                .commit();

            await sanityClient.createOrReplace({
                _id: seller_quantity._id,
                _type: 'seller_product_details',
                seller_id: seller_quantity?.seller,
                product_id: productPayload.product,
                pincode: productPayload.pincode,
                quantity: (seller_quantity?.quantity ?? 0) - productPayload.quantity,
                geoPoint: {
                    lat: productPayload?.geoPoint.lat,
                    lng: productPayload?.geoPoint.lng
                }
            })

            // ✅ Create Order Document in Sanity
            const orderDocument = {
                _id: uuid(),
                _type: 'order',
                customer: { _ref: productPayload.customer },
                product: [{ _ref: productPayload.product }],
                quantity: productPayload.quantity,
                transactionId: productPayload.transactionId,
                orderId: productPayload.orderId,
                paymentSignature: productPayload.paymentSignature,
                amount: productPayload.amount,
                status: 'orderPlaced'
            };

            const createdOrder = await sanityClient.create(orderDocument);
            console.log('Order created successfully:', {
                orderId: createdOrder._id,
                customerId: productPayload.customer,
                productId: productPayload.product,
                amount: productPayload.amount,
                status: 'orderPlaced'
            });

            // ✅ ALGORITHM: Find and assign sellers with PARTIAL FULFILLMENT SUPPORT
            // Step 1: Fetch the product details
            const productDetails: ProductType = await sanityClient.fetch(`*[_type == 'product' && _id == "${productPayload.product}"][0]`);

            if (!productDetails) {
                throw new Error(`Product not found: ${productPayload.product}`);
            }

            const unitPrice = productDetails.price?.pdtPrice ?? productPayload.amount / productPayload.quantity;
            let remainingQuantity = productPayload.quantity;
            let fulfilledQuantity = 0;
            let totalFulfilledAmount = 0;
            const MAX_RADIUS_KM = 5;
            const assignedSellers: Array<{
                sellerId: string;
                quantity: number;
                amount: number;
                distance: number;
                sellerProductDetailsId: string;
            }> = [];

            // Step 2: Fetch ALL sellers sorted by distance (no quantity filter initially)
            const allSellersByDistance = await sanityClient.fetch(`
                *[_type == 'seller_product_details' 
                    && product_id == "${productPayload.product}"
                    && pincode == "${productPayload.pincode}"
                ] | order(geo::distance(geoPoint, geo::latLng(${productPayload.geoPoint.lat}, ${productPayload.geoPoint.lng})) asc) {
                    _id,
                    seller,
                    product_id,
                    quantity,
                    pincode,
                    "distance": geo::distance(geoPoint, geo::latLng(${productPayload.geoPoint.lat}, ${productPayload.geoPoint.lng}))
                }
            `);

            // Step 3: PARTIAL FULFILLMENT - Assign sellers until quantity is fulfilled or radius limit exceeded
            if (allSellersByDistance && allSellersByDistance.length > 0) {
                for (const seller of allSellersByDistance) {
                    // Stop if radius exceeds 5km
                    if (seller.distance > MAX_RADIUS_KM) {
                        console.warn(`Stopping seller search - radius exceeded ${MAX_RADIUS_KM}km. Distance: ${seller.distance?.toFixed(2)}km`);
                        break;
                    }

                    // Skip sellers with no stock
                    if (!seller.quantity || seller.quantity <= 0) {
                        console.log(`Seller ${seller._id} has no stock, skipping`);
                        continue;
                    }

                    // Calculate how much this seller can fulfill
                    const quantityFromThisSeller = Math.min(seller.quantity, remainingQuantity);
                    const amountFromThisSeller = quantityFromThisSeller * unitPrice;

                    // Track this seller's assignment
                    assignedSellers.push({
                        sellerId: seller.seller,
                        quantity: quantityFromThisSeller,
                        amount: amountFromThisSeller,
                        distance: seller.distance,
                        sellerProductDetailsId: seller._id
                    });

                    fulfilledQuantity += quantityFromThisSeller;
                    totalFulfilledAmount += amountFromThisSeller;
                    remainingQuantity -= quantityFromThisSeller;

                    console.log(`Seller ${seller.seller} assigned ${quantityFromThisSeller} units at distance ${seller.distance?.toFixed(2)}km`);

                    // Stop if all quantity is fulfilled
                    if (remainingQuantity <= 0) {
                        break;
                    }
                }
            }

            // Step 4: Check if partial fulfillment is happening
            const isPartialFulfillment = fulfilledQuantity > 0 && fulfilledQuantity < productPayload.quantity;
            const refundAmount = (productPayload.quantity - fulfilledQuantity) * unitPrice;

            // Step 5: Create OrderAcceptedBySeller documents for each assigned seller
            if (assignedSellers.length > 0) {
                for (const assignment of assignedSellers) {
                    const sellerOrderDocument = {
                        _type: 'orderAcceptedBySeller',
                        order: { _ref: createdOrder._id },
                        seller: { _ref: assignment.sellerId },
                        products: [{
                            product: { _ref: productPayload.product },
                            quantity: assignment.quantity,
                            price: unitPrice
                        }],
                        status: 'pending',
                        totalAmount: assignment.amount,
                        isPartialFulfillment: isPartialFulfillment,
                        notes: isPartialFulfillment
                            ? `Partial fulfillment: ${assignment.quantity} units at distance ${assignment.distance?.toFixed(2)}km (Total order: ${productPayload.quantity} units, Refund: ₹${refundAmount?.toFixed(2)})`
                            : `Full fulfillment: ${assignment.quantity} units at distance ${assignment.distance?.toFixed(2)}km`
                    };

                    const createdSellerOrder = await sanityClient.create(sellerOrderDocument);
                    console.log('Seller order assigned:', {
                        sellerOrderId: createdSellerOrder._id,
                        sellerId: assignment.sellerId,
                        quantity: assignment.quantity,
                        distance: assignment.distance?.toFixed(2),
                        isPartial: isPartialFulfillment
                    });

                    // ✅ SEND NOTIFICATION TO SELLER VIA KAFKA
                    const kafkaProducer = kafka.producer();
                    await kafkaProducer.connect();

                    await kafkaProducer.send({
                        topic: 'seller-order-notification-topic',
                        messages: [{
                            value: JSON.stringify({
                                notificationId: uuid(),
                                sellerOrderId: createdSellerOrder._id,
                                orderId: createdOrder._id,
                                sellerId: assignment.sellerId,
                                customerId: productPayload.customer,
                                productId: productPayload.product,
                                quantity: assignment.quantity,
                                totalAmount: assignment.amount,
                                distance: assignment.distance?.toFixed(2),
                                isPartialFulfillment: isPartialFulfillment,
                                status: 'pending',
                                timestamp: new Date().toISOString(),
                                message: isPartialFulfillment
                                    ? `New partial order: ${assignment.quantity} units (${assignment.distance?.toFixed(2)}km away)`
                                    : `New order: ${assignment.quantity} units (${assignment.distance?.toFixed(2)}km away)`
                            })
                        }]
                    });

                    await kafkaProducer.disconnect();
                    console.log('Seller notification sent to Kafka:', {
                        sellerOrderId: createdSellerOrder._id,
                        sellerId: assignment.sellerId
                    });

                    // Update the seller's product quantity
                    // Get the original seller stock to calculate remaining
                    const sellerStockBefore = allSellersByDistance.find((s: any) => s._id === assignment.sellerProductDetailsId)?.quantity ?? 0;
                    await sanityClient.patch(assignment.sellerProductDetailsId)
                        .set({
                            quantity: Math.max(0, sellerStockBefore - assignment.quantity)
                        })
                        .commit();
                }

                // Step 6: If partial fulfillment, update order with refund info and trigger refund process
                if (isPartialFulfillment) {
                    await sanityClient.patch(createdOrder._id)
                        .set({
                            fulfilledQuantity: fulfilledQuantity,
                            refundAmount: refundAmount,
                            refundStatus: 'pending',
                            partialFulfillmentReason: `Only ${fulfilledQuantity}/${productPayload.quantity} units available within ${MAX_RADIUS_KM}km radius`
                        })
                        .commit();

                    console.log('Partial fulfillment order updated with refund info:', {
                        orderId: createdOrder._id,
                        fulfilledQuantity,
                        remainingQuantity: productPayload.quantity - fulfilledQuantity,
                        refundAmount: refundAmount?.toFixed(2),
                        reason: `Insufficient stock within ${MAX_RADIUS_KM}km radius`
                    });

                    // Trigger refund process via Kafka
                    const kafkaProducer = kafka.producer();
                    await kafkaProducer.connect();

                    await kafkaProducer.send({
                        topic: 'order-refund-topic',
                        messages: [{
                            value: JSON.stringify({
                                orderId: createdOrder._id,
                                transactionId: productPayload.transactionId,
                                customerId: productPayload.customer,
                                customerEmail: productPayload.customerEmail,
                                refundAmount: refundAmount,
                                reason: `Partial fulfillment refund - ${remainingQuantity} units couldn't be fulfilled`,
                                originalAmount: productPayload.amount,
                                fulfilledAmount: totalFulfilledAmount,
                                fulfilledQuantity: fulfilledQuantity,
                                requestedQuantity: productPayload.quantity
                            })
                        }]
                    });

                    // ✅ SEND CUSTOMER NOTIFICATION FOR PARTIAL FULFILLMENT
                    await kafkaProducer.send({
                        topic: 'customer-order-notification-topic',
                        messages: [{
                            value: JSON.stringify({
                                notificationId: uuid(),
                                orderId: createdOrder._id,
                                customerId: productPayload.customer,
                                customerEmail: productPayload.customerEmail,
                                productId: productPayload.product,
                                quantity: fulfilledQuantity,
                                totalAmount: totalFulfilledAmount,
                                isPartialFulfillment: true,
                                refundAmount: refundAmount,
                                status: 'processing',
                                timestamp: new Date().toISOString(),
                                message: `Your order is partially fulfilled. ${fulfilledQuantity}/${productPayload.quantity} items assigned. Refund of ₹${refundAmount?.toFixed(2)} will be processed.`
                            })
                        }]
                    });

                    await kafkaProducer.disconnect();
                    console.log('Refund event and customer notification sent to Kafka:', { orderId: createdOrder._id, refundAmount });
                }
            } else {
                // No sellers available within radius - full refund
                console.warn(`No sellers available for product ${productPayload.product} at pincode ${productPayload.pincode} within ${MAX_RADIUS_KM}km radius`);

                await sanityClient.patch(createdOrder._id)
                    .set({
                        fulfilledQuantity: 0,
                        refundAmount: productPayload.amount,
                        refundStatus: 'pending',
                        partialFulfillmentReason: `No sellers available within ${MAX_RADIUS_KM}km radius`
                    })
                    .commit();

                // Trigger full refund via Kafka
                const kafkaProducer = kafka.producer();
                await kafkaProducer.connect();

                await kafkaProducer.send({
                    topic: 'order-refund-topic',
                    messages: [{
                        value: JSON.stringify({
                            orderId: createdOrder._id,
                            transactionId: productPayload.transactionId,
                            customerId: productPayload.customer,
                            customerEmail: productPayload.customerEmail,
                            refundAmount: productPayload.amount,
                            reason: `Full refund - no sellers available within ${MAX_RADIUS_KM}km radius`,
                            originalAmount: productPayload.amount,
                            fulfilledAmount: 0,
                            fulfilledQuantity: 0,
                            requestedQuantity: productPayload.quantity
                        })
                    }]
                });

                // ✅ SEND CUSTOMER NOTIFICATION FOR FULL REFUND
                await kafkaProducer.send({
                    topic: 'customer-order-notification-topic',
                    messages: [{
                        value: JSON.stringify({
                            notificationId: uuid(),
                            orderId: createdOrder._id,
                            customerId: productPayload.customer,
                            customerEmail: productPayload.customerEmail,
                            productId: productPayload.product,
                            quantity: 0,
                            totalAmount: 0,
                            isPartialFulfillment: false,
                            refundAmount: productPayload.amount,
                            status: 'rejected',
                            timestamp: new Date().toISOString(),
                            message: `Unfortunately, no sellers available for your order. Full refund of ₹${productPayload.amount?.toFixed(2)} will be processed.`
                        })
                    }]
                });

                await kafkaProducer.disconnect();
                console.log('Full refund event and customer notification sent to Kafka:', { orderId: createdOrder._id });
            }

            consumer.commitOffsets([
                { topic, partition, offset: message.offset },
            ]);
        } catch (error: Error | any) {
            console.error('Failed to process order message:', {
                error: error?.message,
                stack: error?.stack,
                payload: message.value.toString()
            });

            // Commit offset even on error to prevent infinite retry loop
            try {
                consumer.commitOffsets([
                    { topic, partition, offset: message.offset },
                ]);
            } catch (commitError) {
                console.error('Failed to commit offset after error:', commitError);
            }
        }
    }

    consumer.run({
        partitionsConsumedConcurrently: 5,
        eachMessage: handleEachMessages,
        autoCommit: false,
    });
}

main();

