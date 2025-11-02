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

            type QuantityObj = {
                _id: string;
                quantityObj?:
                { quantity: number; _key: string; _type: string, pincode: string }
            }
            const getQtyOnPincode: QuantityObj = await sanityClient.fetch(`*[_type == 'product'
                && _id match '${productPayload._id}'][0]{
                _id,
                "quantityObj": quantity[pincode match "${productPayload.pincode}"][0] 
              }`);
            //if record was found update the particular document in the array with extra quantity
            if (getQtyOnPincode.quantityObj != null) {

                const result = await sanityClient
                    .patch(productPayload._id)
                    .set({
                        productName: productPayload?.productName,
                        imagesBase64: productPayload.imagesBase64,
                        eanUpcIsbnGtinAsinType: productPayload.eanUpcIsbnGtinAsinType,
                        eanUpcNumber: productPayload.eanUpcNumber,
                        category: productPayload.category,
                        modelNumber: productPayload.modelNumber,
                        productDescription: productPayload.productDescription,
                        price: {
                            pdtPrice: productPayload.price.pdtPrice,
                            discountPercentage: productPayload.price.discountPercentage,
                            currency: productPayload?.price.currency
                        },
                        keywords: productPayload.keywords
                    })
                    .insert("replace",
                        "quantity", [{
                            pincode: productPayload.pincode,
                            quantity: productPayload.quantity + getQtyOnPincode?.quantityObj.quantity,
                            _key: uuid()
                        }]
                    )
                    .commit();
                console.log(`result after updating quantity of a pincode:`, result);
            }
            else {
                await sanityClient
                    .patch(productPayload._id)
                    .set({
                        productName: productPayload?.productName,
                        imagesBase64: productPayload.imagesBase64,
                        eanUpcIsbnGtinAsinType: productPayload.eanUpcIsbnGtinAsinType,
                        eanUpcNumber: productPayload.eanUpcNumber,
                        category: productPayload.category,
                        modelNumber: productPayload.modelNumber,
                        productDescription: productPayload.productDescription,
                        price: {
                            pdtPrice: productPayload.price.pdtPrice,
                            discountPercentage: productPayload.price.discountPercentage,
                            currency: productPayload?.price.currency
                        },
                        keywords: productPayload.keywords
                    })
                    .append(
                        "quantity", [{
                            pincode: productPayload.pincode, quantity: productPayload.quantity,
                            _key: uuid()
                        }]
                    )
                    .commit();
            }
            //update the product to redis
            let clearinterval: string | number | NodeJS.Timeout;
            if (redisClient.isOpen) {
                redisClient.hset("products:details",
                    productPayload._id, JSON.stringify(productPayload))
            } else {
                clearinterval = setInterval(() => {
                    redisClient.hset("products:details",
                        productPayload._id, JSON.stringify(productPayload))
                    clearInterval(clearinterval)
                }, 5000);
            }

            const seller_quantity = await sanityClient.fetch(`*[_type=='seller_product_details' 
                    && product_id match "${productPayload._id}"
                    && seller_id match "${productPayload.seller}"
                    ][0]`);

            const success = await sanityClient.createOrReplace({
                _id: seller_quantity._id,
                _type: 'seller_product_details',
                seller_id: productPayload.seller,
                product_id: productPayload._id,
                pincode: productPayload.pincode,
                quantity: productPayload.quantity,
                geoPoint: {
                    lat: productPayload?.geoPoint.lat,
                    lng: productPayload?.geoPoint.lng
                }
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

