import cluster from "node:cluster";
import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { availableParallelism } from "node:os";
import { ProductType } from "@declaration/productType";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OllamaEmbeddings } from "@langchain/ollama";
import { createClient as RedisClient } from "redis";
import { uuidv4 } from "uuidv7"; // If needed, or just remove if unused


const kafka: Kafka = new Kafka({
  clientId: "xvstore",
  brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
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


  const redisClient = RedisClient({
    url: "redis://redis_storage:6379"
  });
  await redisClient.connect();

  const redisVectorDB = RedisClient({
    url: "redis://redis_vector_db:6379"
  });
  await redisVectorDB.connect();

  async function main() {
    const consumer = kafka.consumer({
      groupId: "product-embedding",
    });

    await consumer.connect();
    await consumer.subscribe({ topics: ["add-product-topic", "update-product-topic"] });

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
        console.log(`product payload :`, productPayload);

        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 1024,
        });

        const textToEmbed = productPayload.productDescription + '\n keywords: ' +
          (productPayload.keywords ? productPayload.keywords.join(", ") : "");

        splitter.splitText(textToEmbed)
          .then(async chunks => {
            const embeddings = await embeddingModel.embedQuery(chunks.join(" "));

            // Store in Redis Vector DB as JSON for HNSW index
            // The index is configured with prefix 'product:' and ON JSON
            await redisVectorDB.json.set(`product:${productPayload._id}`, '$', {
              product_id: productPayload._id,
              embedding: embeddings
            });

            console.log(`Stored embedding for product: ${productPayload._id}`);

            // Also keep in legacy hashset if needed by other services
            await redisClient.hSet("product:embeddings", productPayload._id, JSON.stringify(embeddings));
          });

      } catch (error: Error | any) {
        console.error("Error processing embedding:", error);
      }
    }

    consumer.run({
      partitionsConsumedConcurrently: 5,
      eachMessage: handleEachMessages,
      autoCommit: false,
    });
  }

  main().catch(console.error);
}
