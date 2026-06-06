import express, { type Express, type Request, type Response } from "express";
import dotenv from "dotenv";
import cors from "cors";
import { Ollama, OllamaEmbeddings } from "@langchain/ollama";
import { createClient as redisClient } from "redis";
import { availableParallelism } from "node:os";

dotenv.config();

const ollamaEmbeddingModel = new OllamaEmbeddings({
  model: 'nomic-embed-text',
  maxConcurrency: availableParallelism(),
  baseUrl: 'http://localhost:11434/',
});

const redisC = redisClient({
  url: 'redis://redis_storage:6379'
});
redisC.on('error', err => console.log('Redis Client Error', err));

const redisVectorDB = redisClient({
  url: 'redis://redis_vector_db:6379'
});
redisVectorDB.on('error', err => console.log('Redis VectorDB Error', err));

const VECTOR_DIMENSION = 768; // nomic-embed-text dimension

try {
  const asyncRedisConnect = async () => {
    await redisC.connect();
    await redisVectorDB.connect();

    // Create HNSW index if not exists
    try {
      await redisVectorDB.ft.create('idx:product_vdb', {
        '$.embedding': {
          type: 'VECTOR',
          ALGORITHM: 'HNSW',
          TYPE: 'FLOAT32',
          DIM: VECTOR_DIMENSION,
          DISTANCE_METRIC: 'COSINE',
          INITIAL_CAP: 1000,
          AS: 'embedding'
        },
        '$.product_id': {
          type: 'TEXT',
          AS: 'product_id'
        }
      }, {
        ON: 'JSON',
        PREFIX: 'product:'
      });
      console.log('HNSW Index created');
    } catch (e: any) {
      if (e.message.includes('Index already exists')) {
        console.log('HNSW Index already exists');
      } else {
        console.error('Error creating HNSW index:', e);
      }
    }
  }
  asyncRedisConnect();
} catch (err) {
  console.error('Redis connection error:', err);
}

const app: Express = express();
app.use(cors());
app.get("/", (req: Request, res: Response) => {
  res.end(process.pid + " alive!");
});

app.get(
  "/search",
  async (req: Request<{}, {}, {}, { s: string }>, res: Response) => {
    console.log("Search Query:", req.query.s);
    try {
      const queryEmbedding: number[] = await ollamaEmbeddingModel.embedQuery(req.query.s);

      // Convert embedding to Float32Buffer for Redis
      const float32Embedding = Buffer.from(new Float32Array(queryEmbedding).buffer);

      const results = await redisVectorDB.ft.search('idx:product_vdb',
        `*=>[KNN 10 @embedding $blob AS distance]`,
        {
          PARAMS: {
            blob: float32Embedding
          },
          SORTBY: 'distance',
          DIALECT: 2,
          RETURN: ['product_id', 'distance']
        }
      );

      console.log("Search Results:", results);
      res.json(results);
    } catch (error: any) {
      console.log("<<Search Error>> :", error.message);
      res.status(500).json({ error: error.message });
    }
  }
);

app.listen(5005, (err?: Error) => {
  if (err)
    console.log("something went wrong on PORT:5005");
  console.log(`<<ProcessID: ${process.pid}>> listening on PORT:5005`);
});