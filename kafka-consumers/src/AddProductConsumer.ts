import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { createClient, SanityClient } from "@sanity/client";
import { createClient as RedisClient } from 'redis'
import type { ProductType } from "@declaration/productType.d.ts";
import { sanityConfig } from "@utils";

const kafka: Kafka = new Kafka({
  clientId: "xvstore",
  brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
});


async function main() {
  const sanityClient: SanityClient = createClient(sanityConfig);

  const redisClient = RedisClient();
  await redisClient.connect();

  const consumer = kafka.consumer({
    groupId: "product-db-save",
  });

  await consumer.connect();
  await consumer.subscribe({ topic: "add-product-topic" });

  async function handleEachMessages({
    heartbeat,
    message,
    partition,
    topic,
  }: EachMessagePayload) {
    console.log("<arrayBufferLike> : ", message.value);
    //pause - resume for db operation & embedding creation

    try {
      const productPayload: ProductType = JSON.parse(
        message.value.toString()
      );
      const checkIfExist = await sanityClient.fetch(`*[_type=="product" && eanUpcNumber=='${productPayload.eanUpcNumber}'][0]{_id}`);

      const result = await sanityClient.createIfNotExists({
        _id: productPayload?._id,
        _type: "product",
        ...productPayload,
        quantity: [{
          pincode: productPayload.pincode,
          quantity: productPayload.quantity
        }]
      });
      heartbeat();
      if (result)
        await sanityClient.patch(productPayload.seller)
          .append('productReferenceAfterListing', [result]).commit();

      await sanityClient.patch(productPayload._id)
        .append('seller', [await sanityClient.fetch(`*[_type=='admin' && _id=='${productPayload.seller}']`)]).commit();


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
        quantity: productPayload.quantity + (seller_quantity?.quantity ?? 0)
      })
      if (success._id)
        redisClient.hset("products:details", productPayload._id, JSON.stringify(productPayload))

      if (checkIfExist != null) {
        await sanityClient.create({
          _type: 'potentialDuplicates',
          existingProduct: checkIfExist,
          potentialDuplicate: productPayload._id
        })
      }
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

