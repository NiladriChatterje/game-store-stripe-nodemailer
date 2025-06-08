import { Worker } from "worker_threads";
import cluster from "cluster";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { availableParallelism } from "os";
import { ProductType } from "@declaration/index.js";
import { sanityConfig } from "@utils/index.js";
import { createClient as SanityClient } from "@sanity/client";
import { createClient as RedisClient, RedisClientType } from "redis";
import jwt from 'jsonwebtoken'
dotenv.config();

if (cluster.isPrimary) {
  new Worker("./dist/BackgroundPingProcess.js");

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

    async function authMiddleware(req: Request, res: Response, next: NextFunction) {
      const token = req.headers.authorization?.split(' ')[1];
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
    app.get("/fetch-all-products", async (req: Request, res: Response) => {
      res.end(await sanityClient.fetch(`*[_type=="product"]`));
    });

    //fetch product inventory for current admin
    app.get(
      "/:_id/fetch-products",
      authMiddleware,
      (req: Request<{ _id: string }>, res: Response) => {
        console.log(req.params._id);
        const NotClonedObject = {
          workerData: {
            adminId: req.params._id,
          },
        };
        const worker = new Worker(
          "./dist/fetchAllProductsOfCurrentAdmin.js",
          NotClonedObject
        );
        worker.on("message", (value: ProductType[]) => {
          console.log(value);
          res.status(200).json(value);
        });
        worker.on("error", (err: Error) => {
          res.status(503).json("Service is down!");
        });
      }
    );

    //fetch particular product info for edit
    app.get(
      "/fetch-product/:productId",
      authMiddleware,
      async (
        req: Request<{ productId: string; adminId: string }>,
        res: Response
      ) => {
        const token: string | undefined = req.headers.authorization?.split(' ')[1]
        console.log(req.params.productId);
        if (token) {
          const NotClonedObject = {
            workerData: {
              productId: req.params.productId,
              adminId: token,
            },
          };
          const worker = new Worker("./dist/fetchProductData.js", NotClonedObject);

          worker.on("message", (value: ProductType[]) => {
            console.log(
              "Product Data of id " + req.params.productId + " : ",
              value
            );
            res.status(200).json(value);
          });
          worker.on("error", (err: Error) => {
            res.status(502).send("Service is down!");
          });
        }
      }
    );

    //post to create the product
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
