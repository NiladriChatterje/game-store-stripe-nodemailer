import cluster from "node:cluster";
import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { availableParallelism } from "node:os";
import { ProductType } from "@declaration/productType";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OllamaEmbeddings } from "@langchain/ollama";
import { createClient as RedisClient } from "redis";
import { createClient as SanityClient } from "@sanity/client";
import { sanityConfig } from "./utils";


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
  const embeddingModel = new OllamaEmbeddings({
    model: 'nomic-embed',
    baseUrl: 'http://localhost:11434',
    maxConcurrency: availableParallelism()
  });

  const sanityClient = SanityClient(sanityConfig);

  const redisClient = RedisClient();
  async function main() {
    const consumer = kafka.consumer({
      groupId: "product-embedding",
    });

    await consumer.connect();
    await consumer.subscribe({ topic: "product-embedding-topic" });

    async function handleEachMessages({
      heartbeat,
      message,
      partition,
      topic,
    }: EachMessagePayload) {
      console.log("<arrayBufferLike> : ", message.value);
      //embedding creation

      try {
        const productPayload: ProductType = JSON.parse(message.value.toString());
        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 1024,
        });


        splitter.splitText(productPayload.productDescription + '\n' +
          productPayload.keywords.map(item => item + ', '))
          .then(async onfulfilled => {
            const embeddings = await embeddingModel
              .embedQuery(onfulfilled.join(" "));

            sanityClient?.createIfNotExists({
              _id: productPayload._id,
              _type: "productEmbeddings",
              embeddings
            })
            console.log(embeddings)
            redisClient.hset('embeddings', { [productPayload._id]: embeddings });
          });


      } catch (error: Error | any) {

      }
    }

    consumer.run({
      partitionsConsumedConcurrently: 6,
      eachMessage: handleEachMessages,
      autoCommit: false,
    });
  }

  main();
}
