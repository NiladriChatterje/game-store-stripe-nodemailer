import express, { type Express, type Request, type Response } from "express";
import dotenv from "dotenv";
import { availableParallelism } from "node:os";
import cluster from "cluster";
import { spawn } from "node:child_process";
import { Ollama, OllamaEmbeddings } from "@langchain/ollama";
import path from "node:path";

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
    model: "mistral-ai",
    baseUrl: "http://localhost:11434",
    maxConcurrency: availableParallelism()
  });

  const ollamaEmbeddingModel = new OllamaEmbeddings({
    model: 'nomic-embed',
    maxConcurrency: availableParallelism(),
    baseUrl: 'http://localhost:11434/'
  });


  const app: Express = express();
  app.get("/", (req: Request, res: Response) => {
    console.log(process.pid + "alive!");
    res.end(process.pid + " alive!");
  });

  app.get(
    "/search",
    (req: Request<{}, {}, {}, { s: string }>, res: Response) => {

      res.download(path.resolve(process.cwd(), './src/abc.txt'));
    }
  );

  app.listen(5005, (err?: Error) => {
    if (err)
      console.log("something went wrong on PORT:5005");
    console.log(`<<ProcessID: ${process.pid}>> listening on PORT:5005`);
  });
}
