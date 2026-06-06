import { createClient as RedisClient } from "redis";
import mysql from "mysql2/promise";
import { OllamaEmbeddings } from "@langchain/ollama";
import { availableParallelism } from "os";
import cron from "node-cron";

const SHARD_CONFIGS = [
  { host: "mysql1", port: 3306, user: "root", password: "", database: "xvstore" },
  { host: "mysql2", port: 3306, user: "root", password: "", database: "xvstore" },
  { host: "mysql3", port: 3306, user: "root", password: "", database: "xvstore" },
  { host: "mysql4", port: 3306, user: "root", password: "", database: "xvstore" },
];

const redisVectorDB = RedisClient({
  url: "redis://redis_vector_db:6379",
});

const embeddingModel = new OllamaEmbeddings({
  model: "nomic-embed-text",
  baseUrl: process.env.OLLAMA_URL || "http://host.docker.internal:11434",
  // Keep this bounded; using availableParallelism() across containers can explode memory/CPU.
  maxConcurrency: Math.max(2, Math.min(availableParallelism(), 4)),
});

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectToRedis() {
  let connected = false;
  while (!connected) {
    try {
      await redisVectorDB.connect();
      console.log("Connected to redis_vector_db");
      connected = true;
    } catch (e) {
      console.log("Waiting for redis_vector_db...");
      await sleep(2000);
    }
  }
}

async function getMysqlConnection(config: any) {
  let connection = null;
  while (!connection) {
    try {
      connection = await mysql.createConnection(config);
      console.log(`Connected to MySQL shard: ${config.host}`);
    } catch (e) {
      console.log(`Waiting for MySQL shard: ${config.host}...`);
      await sleep(2000);
    }
  }
  return connection;
}

/**
 * Non-overlap guard to prevent cron runs stacking up if a run takes > 30 min.
 */
let isSyncInProgress = false;

async function syncEmbeddings() {
  if (isSyncInProgress) {
    console.warn("Embedding Sync already in progress; skipping this run.");
    return;
  }

  isSyncInProgress = true;
  console.log("Starting Embedding Sync Job...");

  const BATCH_SIZE = 200; // tune based on heap; keep it small to avoid loading huge arrays
  try {
    await connectToRedis();

    for (const config of SHARD_CONFIGS) {
      const connection = await getMysqlConnection(config);

      try {
        // Cursor pagination by id to avoid loading entire table into memory.
        let lastSeenId = 0;

        while (true) {
          const [rows]: any = await connection.execute(
            `SELECT id, product_name, category, product_description
             FROM products
             WHERE id > ?
             ORDER BY id ASC
             LIMIT ?`,
            [lastSeenId, BATCH_SIZE]
          );

          if (!Array.isArray(rows) || rows.length === 0) {
            break;
          }

          console.log(`Fetched ${rows.length} products from ${config.host} (id > ${lastSeenId})`);

          for (const row of rows) {
            const productId = row.id;
            const redisKey = `product:${productId}`;

            // Check if product exists in redis_vector_db
            const exists = await redisVectorDB.exists(redisKey);

            if (exists) continue;

            const textToEmbed = `name: ${row.product_name}
category: ${row.category}
description: ${row.product_description}`;

            try {
              const embedding = await embeddingModel.embedQuery(textToEmbed);

              await redisVectorDB.json.set(redisKey, "$", {
                product_id: productId,
                embedding: embedding,
              });

              console.log(`Stored embedding for product ${productId}`);
            } catch (embedError: any) {
              console.error(`Failed to generate/store embedding for ${productId}:`, embedError?.message || embedError);
            }

            lastSeenId = productId;
          }
        }
      } catch (dbError: any) {
        console.error(`Error syncing shard ${config.host}:`, dbError?.message || dbError);
      } finally {
        await connection.end();
      }
    }

    console.log("Embedding Sync iteration completed.");
  } catch (err) {
    console.error("Embedding Sync failed:", err);
  } finally {
    isSyncInProgress = false;
  }
}

// Run immediately on startup
syncEmbeddings()
  .then(() => {
    // Schedule to run every 30 minutes (guard prevents overlaps)
    cron.schedule("*/30 * * * *", () => {
      syncEmbeddings().catch(console.error);
    });
    console.log("Cron job scheduled to run every 30 minutes.");
  })
  .catch(console.error);
