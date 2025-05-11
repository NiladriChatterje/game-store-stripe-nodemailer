import express, { type Express, type Request, type Response } from "express";
import dotenv from "dotenv";
import { availableParallelism } from "node:os";
import cluster from "cluster";
import { spawn } from "node:child_process";
import { Ollama, OllamaEmbeddings } from "@langchain/ollama";
import { createClient as redisClient } from "redis";

dotenv.config();

if (cluster.isPrimary) {
  setInterval(() => {
    let p = spawn("curl", ["-X", "GET", "http://localhost:5005/"]);
    p.kill();
  }, 60000);

  for (let i = 0; i < availableParallelism(); i++) {
    let p = cluster.fork();

    p.on("exit", () => {
      p = cluster.fork();
    });
  }
} else {
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

  // const redisC = redisClient();
  // redisC.on('error', err => console.log('Redis Client Error', err));

  // const asyncRedisConnect = async () => {
  //   await redisC.connect();

  // }
  // asyncRedisConnect();
  // redisC.hSet("", [])

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

      } catch (error) {
        console.log("<<Model error>>")
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
