import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { createClient, SanityClient } from "@sanity/client";
import { createClient as RedisClient } from "redis";
import type { ProductType } from "../declaration/productType.d.ts";
import { sanityConfig } from "@utils";

const kafka: Kafka = new Kafka({
    clientId: "xvstore",
    brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
});


async function main() {
    const redisClient = RedisClient();
    await redisClient.connect();
    const sanityClient: SanityClient = createClient({
        ...sanityConfig,
        perspective: "published",
    });
    const consumer = kafka.consumer({
        groupId: "product-db-update",
    });

    await consumer.connect();
    await consumer.subscribe({ topic: "update-product-topic" });

    async function handleEachMessages({
        heartbeat,
        message,
        partition,
        topic,
    }: EachMessagePayload) {
        console.log("<arrayBufferLike> : ", message.value);

        try {
            const productPayload: ProductType = JSON.parse(
                message.value.toString()
            );

            const getQty = await sanityClient.fetch(`*[_type == 'product'
                            && _id match '${productPayload._id}'][0]{
                            "quantity": quantity[pincode match "${productPayload.pincode}"][0].quantity 
                          }`);

            const result = await sanityClient
                .patch(productPayload._id)
                .setIfMissing({
                    quantity: [{
                        [productPayload.pincode]: 0
                    }]
                }).append(
                    "quantity", [{
                        [productPayload.pincode]: productPayload.quantity + getQty.quantity
                    }]
                )
                .commit()

            const seller_quantity = await sanityClient.fetch(`*[_type=='seller_product_details' 
                    && product_id match "${productPayload._id}"
                    && seller_id match "${productPayload.seller}"
                    ]`);
            const success = await sanityClient.createOrReplace({
                _id: seller_quantity._id,
                _type: 'seller_product_details',
                seller_id: productPayload.seller,
                product_id: productPayload._id,
                pincode: productPayload.pincode,
                quantity: productPayload.quantity + (seller_quantity?.quantity ?? 0),
                geoPoint: {
                    lat: productPayload?.geoPoint.lat,
                    lng: productPayload?.geoPoint.lng
                }
            })
            redisClient.hset("products:details", productPayload._id, JSON.stringify({
                ...productPayload,
                quantity: productPayload.quantity + getQty.quantity
            }))
            consumer.commitOffsets([
                { topic, partition, offset: message.offset },
            ]);
        } catch (error: Error | any) { }
    }

    consumer.run({
        partitionsConsumedConcurrently: 5,
        eachMessage: handleEachMessages,
        autoCommit: false,
    });
}

main();

