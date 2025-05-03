import express, { type Express, type Request, type Response } from "express";
import dotenv from "dotenv";
import { availableParallelism } from "node:os";
import cluster from "cluster";
import { spawn } from "node:child_process";
dotenv.config();

if (cluster.isPrimary) {
  setInterval(() => {
    spawn("curl", ["-X", "GET", "http://localhost:5005/"]);
  }, 60000);

  for (let i = 0; i < availableParallelism(); i++) {
    let p = cluster.fork();

    p.on("error", () => {
      p = cluster.fork();
    });
  }
} else {
  const app: Express = express();
  app.get("/", (req: Request, res: Response) => {
    res.end("alive!");
  });

  app.get(
    "/search",
    (req: Request<{}, {}, {}, { s: string }>, res: Response) => {}
  );
}
