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

