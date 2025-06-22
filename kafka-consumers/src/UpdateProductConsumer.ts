import cluster from "node:cluster";
import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { availableParallelism } from "node:os";
import { createClient, SanityClient } from "@sanity/client";
import { createClient as RedisClient } from "redis";
import { ProductType } from "@declaration/productType";
import { sanityConfig } from "@utils";

const kafka: Kafka = new Kafka({
    clientId: "xvstore",
    brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
    ssl: true,
});

if (cluster.isPrimary) {
    let i = 0;
    while (i < availableParallelism()) {
        cluster.fork();
        cluster.on("exit", () => {
            cluster.fork();
        });
    }
} else {
    async function main() {
        const redisClient = RedisClient();
        await redisClient.connect();
        const sanityClient: SanityClient = createClient({
            ...sanityConfig,
            perspective: "published",
        });
        const consumer = kafka.consumer({
            groupId: "product-update-db-save",
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

                const getQty = await sanityClient.fetch(`* [_type == 'product'
                                && seller[]._ref match "${productPayload.seller}"
                            && quantity[].key match '${productPayload.pincode}'][0]{
                            "quantity": quantity[key == ${productPayload.pincode}][0].value 
                          }`)
                const result = await sanityClient
                    .patch(productPayload._id)
                    .setIfMissing({
                        quantity: {
                            [productPayload.pincode]: 0
                        }
                    }).set({
                        quantity: {
                            [productPayload.pincode]: productPayload.quantity + getQty.quantity
                        }
                    })
                    .commit()

                await sanityClient.createOrReplace({
                    _id: productPayload.seller,
                    _type: 'seller_product_details',
                    seller_id: productPayload.seller,
                    product_id: productPayload._id,
                    pincode: productPayload.pincode,
                    quantity: productPayload.quantity + getQty.quantity
                })

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
}
