import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { createClient, SanityClient } from "@sanity/client";
import { createClient as RedisClient } from 'redis'
import type { ProductType } from "@declaration/productType.d.ts";
import { sanityConfig } from "@utils";
import { uuidv4 } from "uuidv7";

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
      //for potential duplicate listing
      const checkIfUPCExist: string = await sanityClient.fetch(`*[_type=="product" && eanUpcNumber=='${productPayload.eanUpcNumber}'][0]{_id}`);

      const result = await sanityClient.createIfNotExists({
        _id: productPayload?._id,
        _type: "product",
        ...productPayload,
        quantity: [{
          _key: uuidv4(),
          pincode: productPayload.pincode,
          quantity: productPayload.quantity
        }]
      });
      heartbeat();

      if (result._id) {
        await sanityClient.patch(productPayload.seller)
          .append('productReferenceAfterListing', [{ _type: 'reference', _ref: productPayload._id }]).commit();

        await sanityClient.patch(productPayload._id)
          .append('seller', [{ _type: 'reference', _ref: productPayload.seller }]).commit();
      }


      const seller_quantity = await sanityClient.fetch(`*[_type=='seller_product_details' 
            && product_id match "${productPayload._id}"
            && seller_id match "${productPayload.seller}"
            && pincode == "${productPayload.pincode}"
            ][0]{...}`);

      if (seller_quantity == null)
        await sanityClient.create({
          _type: 'seller_product_details',
          seller_id: productPayload.seller,
          product_id: productPayload._id,
          pincode: productPayload.pincode,
          quantity: productPayload.quantity
        });
      else
        await sanityClient.patch(seller_quantity?._id)
          .set({
            quantity: productPayload.quantity + (seller_quantity?.quantity ?? 0)
          }).commit()


      redisClient.hset("products:details", productPayload._id, JSON.stringify(productPayload))

      //map this product with similar products already listed
      if (checkIfUPCExist != null) {
        await sanityClient.create({
          _type: 'potentialDuplicates',
          existingProduct: checkIfUPCExist,
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

