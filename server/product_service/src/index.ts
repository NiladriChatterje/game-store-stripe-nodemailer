import { Worker } from "worker_threads";
import cluster from "cluster";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { availableParallelism } from "os";
import type { ProductType } from "@declaration/index.d.ts";
import type { AdminFieldsType } from "@declaration/AdminFieldType.d.ts";
import { sanityConfig } from "@utils/index.js";
import { createClient as SanityClient } from "@sanity/client";
import { createClient as RedisClient, RedisClientType } from "redis";
import { ClerkExpressRequireAuth } from "@clerk/clerk-sdk-node";
import { spawn } from "child_process";
dotenv.config();

if (cluster.isPrimary) {

  let old_child_process: any[] = []
  setInterval(() => {
    const child_process = spawn('curl.exe', [
      '-X',
      'GET',
      `http://localhost:${process.env.PORT}/`,
    ])

    while (old_child_process.length > 0) {
      let pop_process = old_child_process.pop()
      pop_process?.kill(0)
    }

    child_process.stdout.on('data', buffer => {
      console.log(buffer.toString('utf-8'))
      old_child_process.push(child_process)
    })
  }, 60000)

  let p;
  for (let i = 0; i < availableParallelism(); i++) {
    p = cluster.fork();
    p.on("exit", (_statusCode: number) => {
      p = cluster.fork();
    });
  }
} else {

  async function main() {
    const app: Express = express();
    const sanityClient = SanityClient(sanityConfig);
    const redisClient: RedisClientType = RedisClient();
    await redisClient.connect();
    app.use(cors());
    app.use(express.json({ limit: "25mb" }));
    app.use(express.urlencoded({ extended: true, limit: "25mb" }));
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      next();
    });

    async function authMiddleware(req: Request<{}, {}, AdminFieldsType>, res: Response, next: NextFunction) {
      const token = req.body._id;
      if (!token)
        res.status(401).send('Missing token!');
      let result;
      result = (await redisClient.get(token as string))?.length;
      if (!result)
        result = await sanityClient.fetch(`count(*[_type=='admin' && _id=='${token}'])`)
      if (result && result > 0)
        next();
      else
        res.status(403).send('Unauthorized token!');
    }

    app.get("/", (req: Request, res: Response) => {
      res.end("pinged!");
    });

    //for all users [that's why no authentication middleware]
    app.get("/fetch-products/:category/:page", async (req: Request<{ category: string; page: number }>, res: Response) => {
      res.setHeader('Content-Type', 'application/json');

      if (redisClient.isOpen) {
        switch (req.params.category) {
          case 'all': {
            let data: string[] = (await redisClient.hVals('products:all')).slice((req.params.page - 1) * 10, (req.params.page) * 10);
            let deserializedData: ProductType[] = data.map(item => JSON.parse(item));
            if (data.length > 0) {
              res.json(deserializedData);
              return;
            }
            data = await sanityClient.fetch(`*[_type=="product"][${(req.params.page - 1) * 10}...${req.params.page * 10}]`);
            deserializedData = data.map(item => JSON.parse(item));
            for (let datum of deserializedData)
              redisClient.hSet('products:all', datum._id, JSON.stringify(datum));
            res.json(deserializedData);
            return;
          }
          case 'groceries': {
            let data = JSON.parse((await redisClient.hGet('products', 'groceries')) as string);
            if (data) {
              res.json(data);
              return;
            }
            data = await sanityClient.fetch(`*[_type=="product" && category=="groceries"][${(req.params.page - 1) * 10}...${req.params.page * 10}]`);
            redisClient.hSet("products", "groceries", JSON.stringify(data));
            res.json(data);
            return;
          }
          case 'gadgets': {
            let data = JSON.parse((await redisClient.hGet('products', 'gadgets')) as string);

            if (data) {
              res.json(data);
              return;
            }
            data = await sanityClient.fetch(`*[_type=="product" && category=="gadgets"][${(req.params.page - 1) * 10}...${req.params.page * 10}]`);
            redisClient.hSet("products", "gadgets", JSON.stringify(data));
            res.json(data);
            return;
          }
        }
      }
      switch (req.params.category) {
        case 'all': res.json(await sanityClient.fetch(`*[_type=="product"][${(req.params.page - 1) * 10}...${req.params.page * 10}]`));
          break;
        case 'groceries': res.json(await sanityClient.fetch(`*[_type=="product" && category=="groceries"][${(req.params.page - 1) * 10}...${req.params.page * 10}]`));
          break;
        case 'gadgets': res.json(await sanityClient.fetch(`*[_type=="product" && category=="gadgets"][${(req.params.page - 1) * 10}...${req.params.page * 10}]`));
          break;
        case 'toys': res.json(await sanityClient.fetch(`*[_type=="product" && category=="toys"][${(req.params.page - 1) * 10}...${req.params.page * 10}]`));
          break;
        default: res.json([]);
      }
    });

    //fetch particular product info for user display
    app.get(
      "/fetch-product-detail/:productId",
      async (
        req: Request<{ productId: string; }>,
        res: Response
      ) => {
        res.setHeader("Content-Type", "application/json");

        const productId: string | undefined = req.params.productId
        if (productId) {
          try {
            const fromRedisResult = await redisClient.hGet('products', productId)
            if (fromRedisResult) {
              res.send(200).json(JSON.parse(fromRedisResult));
              return;
            }
            const result = await sanityClient.fetch(`*[_type=='product' && _id=='${productId}'][0]`);
            res.status(200).json(result);
            return;
          }
          catch (err) {
            res.status(502).json({ error: "Service down!" });
            return;
          }
        }
      }
    );

    //post to kafka topic [product-topic] to create the product
    app.post(
      "/add-product",
      // authMiddleware,
      async (req: Request<{}, {}, ProductType>, res: Response) => {
        const worker = new Worker("./dist/AddProductData.js", {
          workerData: req.body,
        });

        worker.on("message", (data) => {
          res.status(data.status).send(data.value);
        });
      }
    );

    //patch to update same product
    app.patch("/update-product",
      ClerkExpressRequireAuth(),
      authMiddleware,
      async (req: Request, res: Response) => {
        const { adminId, plan } = req.body;
      });

    app.listen(process.env.PORT ?? 5002, () =>
      console.log("listening on PORT:" + process.env.PORT)
    );
  }
  main();
}
