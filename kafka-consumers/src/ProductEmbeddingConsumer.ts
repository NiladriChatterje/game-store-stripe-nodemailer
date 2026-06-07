import { EachMessagePayload, Kafka } from "kafkajs";
import type { ProductType } from "@declaration/productType";
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
  console.error('[product-embedding-consumer] Redis VectorDB Error:', err)
);

/**
 * Wait for the HNSW vector index (idx:product_vdb) to exist on redis-stack.
 * The index is created by search_engine_service at startup.
 * This function polls FT.INFO until the index is ready, so the consumer
 * does not store embeddings before the index exists.
 */
async function waitForIndex(maxRetries = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await redisVectorDB.ft.info('idx:product_vdb');
      console.log('[product-embedding-consumer] HNSW index idx:product_vdb is ready');
      return;
    } catch {
      if (attempt < maxRetries) {
        console.log(`[product-embedding-consumer] Waiting for HNSW index... attempt ${attempt}/${maxRetries}`);
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        console.warn(
          `[product-embedding-consumer] HNSW index not found after ${maxRetries} attempts. ` +
          'Embeddings will be stored but may not be searchable until search_engine_service creates the index.'
        );
      }
    }
  }
}

async function main() {
  await redisVectorDB.connect();

  // Wait for the HNSW index (created by search_engine_service) to be ready.
  // This ensures embeddings are stored only after the index exists for KNN search.
  await waitForIndex();

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

    console.log(
      `[product-embedding-consumer] msg topic=${topic} partition=${partition} offset=${message.offset} valueBytes=${message.value?.length ?? 0}`
    );

    try {
      const productPayload: ProductType = JSON.parse(message.value.toString());
      const productId = productPayload._id;
      console.log(`[product-embedding-consumer] embedding request productId=${productId ?? "missing"}`);

      if (!productId) {
        console.warn("[product-embedding-consumer] Product payload missing _id, skipping.");
        return;
      }

      // Build a rich text representation for high-quality embeddings
      const textToEmbed = [
        `name: ${productPayload.productName ?? ""}`,
        `category: ${productPayload.category ?? ""}`,
        `description: ${productPayload.productDescription ?? ""}`,
        `keywords: ${productPayload.keywords?.length ? productPayload.keywords.join(", ") : ""}`,
      ].join("\n");

      // Keep Kafka consumer alive during potentially long Ollama inference
      await heartbeat();

      const embeddings: number[] = await embeddingModel.embedQuery(textToEmbed);

      // Store as JSON — the HNSW index (PREFIX: 'product:') automatically indexes
      // the '$.embedding' vector field and '$.product_id' text field for KNN search.
      await redisVectorDB.json.set(`product:${productId}`, '$', {
        product_id: productId,
        embedding: embeddings,
      });

      console.log(`[product-embedding-consumer] Stored embedding for product: ${productId} (dim=${embeddings.length})`);

      // Commit offset on success
      await consumer.commitOffsets([
        { topic, partition, offset: message.offset },
      ]);

    } catch (error: Error | any) {
      console.error("[product-embedding-consumer] Error processing embedding:", error?.message || error);

      // Commit offset even on error to prevent infinite reprocessing of the same bad message
      try {
        await consumer.commitOffsets([
          { topic, partition, offset: message.offset },
        ]);
      } catch (commitError) {
        console.error("[product-embedding-consumer] Failed to commit offset after error:", commitError);
      }
    }
  }

  await consumer.run({
    partitionsConsumedConcurrently: 5,
    eachMessage: handleEachMessages,
    autoCommit: false,
  });
}

main().catch(console.error);
