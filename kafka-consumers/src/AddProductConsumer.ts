import cluster from "node:cluster";
import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { availableParallelism } from "node:os";
import { createClient, SanityClient } from "@sanity/client";
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
    const sanityClient: SanityClient = createClient({
      ...sanityConfig,
      perspective: "published",
    });
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
        const checkIfExist = await sanityClient.fetch(`*[_type=="product" && eanUpcIsbnGtinAsinNumber=='${productPayload.eanUpcNumber}'][0]`);
        if (checkIfExist == null) {
          const result = await sanityClient.createIfNotExists({
            _id: productPayload?._id,
            _type: "product",
            ...productPayload,
          });

          if (result)
            await sanityClient.patch(productPayload.seller)
              .append('productReferenceAfterListing', [result]).commit();

          await sanityClient.patch(productPayload._id)
            .append('seller', [await sanityClient.fetch(`*[_type=='admin' && _id=='${productPayload.seller}']`)]).commit();
        } else {
          productPayload.seller
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
}
