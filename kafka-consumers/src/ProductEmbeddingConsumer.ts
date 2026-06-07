import { EachMessagePayload, Kafka } from "kafkajs";
import { ProductType } from "@declaration/productType";
import { OllamaEmbeddings } from "@langchain/ollama";
import { createClient as RedisClient } from "redis";

const kafka: Kafka = new Kafka({
  clientId: "xvstore",
  brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});

const embeddingModel = new OllamaEmbeddings({
  model: 'nomic-embed-text',
  baseUrl: (typeof globalThis !== 'undefined' &&
    (globalThis as unknown as { process?: { env?: { OLLAMA_URL?: string } } }).process?.env?.OLLAMA_URL) ||
    'http://host.docker.internal:11434',
  maxConcurrency: 4
});

const redisVectorDB = RedisClient({
  url: "redis://redis_vector_db:6379"
});

redisVectorDB.on('error', (err: unknown) =>
  console.error('Redis VectorDB Error:', err)
);
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
    if (!message.value) return;

    // Avoid logging full payload/buffers (can be huge and cause memory/CPU spikes)
    console.log(
      `[product-embedding-consumer] msg topic=${topic} partition=${partition} offset=${message.offset} valueBytes=${message.value?.length ?? 0}`
    );

    try {
      const productPayload: ProductType = JSON.parse(message.value.toString());
      const productId = productPayload._id;
      // Keep logs small (avoid dumping full payload)
      console.log(`[product-embedding-consumer] embedding request productId=${productId ?? "missing"}`);

      if (!productId) {
        console.warn("Product payload is missing _id, skipping embedding generation.");
        return;
      }

      // Build a rich text representation of the product to create a high-quality embedding.
      // Product name and category are essential for matching queries.
      const textToEmbed = `name: ${productPayload.productName || ""}
category: ${productPayload.category || ""}
description: ${productPayload.productDescription || ""}
keywords: ${productPayload.keywords ? productPayload.keywords.join(", ") : ""}`;

      // Keep Kafka connection alive during embedding computation
      await heartbeat();

      const embeddings = await embeddingModel.embedQuery(textToEmbed);

      // Store the embedding in redis_vector_db under JSON for HNSW vector search
      await redisVectorDB.json.set(`product:${productId}`, '$', {
        product_id: productId,
        embedding: embeddings
      });

      console.log(`Stored embedding for product: ${productId}`);

      // Manually commit offsets since autoCommit is false
      await consumer.commitOffsets([
        { topic, partition, offset: message.offset },
      ]);

    } catch (error: Error | any) {
      console.error("Error processing embedding:", error);
    }
  }

  await consumer.run({
    partitionsConsumedConcurrently: 5,
    eachMessage: handleEachMessages,
    autoCommit: false,
  });
}

main().catch(console.error);
