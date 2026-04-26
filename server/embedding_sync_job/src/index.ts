import { createClient as RedisClient } from "redis";
import mysql from "mysql2/promise";
import { OllamaEmbeddings } from "@langchain/ollama";
import { availableParallelism } from "os";

const SHARD_CONFIGS = [
    { host: 'mysql1', port: 3306, user: 'root', password: '', database: 'xvstore' },
    { host: 'mysql2', port: 3306, user: 'root', password: '', database: 'xvstore' },
    { host: 'mysql3', port: 3306, user: 'root', password: '', database: 'xvstore' },
    { host: 'mysql4', port: 3306, user: 'root', password: '', database: 'xvstore' },
];

const redisVectorDB = RedisClient({
    url: 'redis://redis_vector_db:6379'
});

const embeddingModel = new OllamaEmbeddings({
    model: 'nomic-embed-text',
    baseUrl: process.env.OLLAMA_URL || 'http://host.docker.internal:11434',
    maxConcurrency: availableParallelism()
});

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

async function syncEmbeddings() {
    console.log("Starting Embedding Sync Job...");
    await connectToRedis();

    for (const config of SHARD_CONFIGS) {
        const connection = await getMysqlConnection(config);
        
        try {
            const [rows]: any = await connection.execute(
                'SELECT id, product_name, category, product_description FROM products'
            );

            console.log(`Found ${rows.length} products in ${config.host}`);

            for (const row of rows) {
                const productId = row.id;
                const redisKey = `product:${productId}`;

                // Check if product exists in redis_vector_db
                const exists = await redisVectorDB.exists(redisKey);
                
                if (!exists) {
                    console.log(`Embedding not found for product ${productId}. Generating...`);
                    
                    const textToEmbed = `${row.product_name} ${row.category} ${row.product_description}`;
                    
                    try {
                        const embedding = await embeddingModel.embedQuery(textToEmbed);
                        
                        await redisVectorDB.json.set(redisKey, '$', {
                            product_id: productId,
                            embedding: embedding
                        });
                        
                        console.log(`Successfully generated and stored embedding for product ${productId}`);
                    } catch (embedError: any) {
                        console.error(`Failed to generate embedding for ${productId}:`, embedError.message);
                    }
                } else {
                    console.log(`Embedding already exists for product ${productId}. Skipping.`);
                }
            }
        } catch (dbError: any) {
            console.error(`Error querying shard ${config.host}:`, dbError.message);
        } finally {
            await connection.end();
        }
    }

    console.log("Embedding Sync Job completed successfully.");
    process.exit(0);
}

syncEmbeddings().catch(console.error);
