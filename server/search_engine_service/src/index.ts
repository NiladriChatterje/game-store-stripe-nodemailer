import express, { type Express, type Request, type Response } from "express";
import dotenv from "dotenv";
import { availableParallelism } from "node:os";
import cluster from "cluster";
import { spawn } from "node:child_process";
import { Ollama, OllamaEmbeddings } from "@langchain/ollama";
import { createClient as redisClient } from "redis";
import { createClient } from "@sanity/client";
import { knn } from "./knn";
import { sanityConfig } from "../utils";

dotenv.config();

if (cluster.isPrimary) {
  setInterval(() => {
    let p = spawn("ping", ["http://localhost:5005/"]);
    p.kill();
  }, 60000);

  for (let i = 0; i < availableParallelism(); i++) {
    let p = cluster.fork();

    p.on("exit", () => {
      p = cluster.fork();
    });
  }
} else {
  const sanityClient = createClient(sanityConfig);

  const model = new Ollama({
    model: "mistral",
    baseUrl: "http://localhost:11434",
    maxConcurrency: availableParallelism(),
  });

  const ollamaEmbeddingModel = new OllamaEmbeddings({
    model: 'nomic-embed-text',
    maxConcurrency: availableParallelism(),
    baseUrl: 'http://localhost:11434/',
  });

  const redisC = redisClient({
    url: 'redis://redis_storage:6379'
  });
  redisC.on('error', err => console.log('Redis Client Error', err));

  try {
    const asyncRedisConnect = async () => {
      await redisC.connect();

    }
    asyncRedisConnect();
  } catch (err) {

  }
  redisC.set("id", JSON.stringify([4, 5]))

  const app: Express = express();
  app.get("/", (req: Request, res: Response) => {
    res.end(process.pid + " alive!");
  });

  app.get(
    "/search",
    async (req: Request<{}, {}, {}, { s: string }>, res: Response) => {
      console.log(req.query.s)
      try {
        const queryEmbedding: number[] = await ollamaEmbeddingModel.embedQuery(req.query.s);
        console.log(queryEmbedding)
        let productEmbeddings: Map<{ toString: {}; }, { toString: {}; }> | {
          toString: {};
        }[] = (await redisC.hGetAll("product:embeddings"))//in product:embeddings hashset, product_id => embeddings(number[])
        if (productEmbeddings) {
          let resultEmbeddings = await sanityClient?.fetch(`*[_type=='productEmbeddings']`);
          productEmbeddings = resultEmbeddings?.map(item => [item.product_id, item.embeddings])
          const ProductId_distance_arr: [string, number][] = knn(productEmbeddings, queryEmbedding);
          console.log(ProductId_distance_arr)
        }
      } catch (error) {
        console.log("<<Model error>> :", error.message)
      }
      res.end("Received")
    }
  );

  app.listen(5005, (err?: Error) => {
    if (err)
      console.log("something went wrong on PORT:5005");
    console.log(`<<ProcessID: ${process.pid}>> listening on PORT:5005`);
  });
}
