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
import { Kafka } from "kafkajs";
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
    const kafka: Kafka = new Kafka({
      clientId: 'xv-store',
      brokers: ['localhost:9092', 'localhost:9093', 'localhost:9094']
    });
    const redisClient: RedisClientType = RedisClient();
    await redisClient.connect();
    app.use(cors());
    app.use(express.json({ limit: "25mb" }));
    app.use(express.urlencoded({ extended: true, limit: "25mb" }));
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      next();
    });

    async function authMiddleware(req: Request<{}, {}, any>, res: Response, next: NextFunction) {
      const token = req.headers['x-admin-id'];
      if (!token) {
        res.status(401).send('Missing token!');
        return;
      }
      let result;
      result = (await redisClient.sIsMember(`set:admin:details`, token as unknown as string));
      if (result) {
        res.status(200).json(result);
        next();
        return;
      }
      result = await sanityClient.fetch(`count(*[_type=='admin' && _id=='${token as unknown as string}'])`)
      if (result && result > 0)
        next();
      else
        res.status(403).send('Unauthorized token!');
    }

    app.get("/", async (req: Request, res: Response) => {
      res.end("pinged!");
    });

    //for all users [that's why no authentication middleware] <Completed> | Dont touch
    app.get("/fetch-products/:pincode/:category/:page", async (req: Request<{ category: string; page: number, pincode: number }>, res: Response) => {
      res.setHeader('Content-Type', 'application/json');

      if (redisClient.isOpen) {
        switch (req.params.category) {
          case 'all': {
            let data: string[] = (await redisClient.hVals('products:all')).slice((req.params.page - 1) * 10, (req.params.page) * 10);
            if (data.length > 0) {
              console.log(`<redis hit>`)
              res.json(data.map(item => JSON.parse(item)));
              return;
            }
            data = await sanityClient.fetch(`*[_type=="product"][${(req.params.page - 1) * 10}...${req.params.page * 10}]{
            ...,
            'quantity':quantity[pincode == '${req.params.pincode}'][0].quantity,
            'seller':null
            }`);
            for (let datum of data) {
              const deserializedData = datum as unknown as ProductType;
              redisClient.hSet('products:all', deserializedData._id, JSON.stringify(datum));
            }

            res.json(data);
            return;
          }

          case 'groceries': {
            let data: string[] = (await redisClient.hVals('products:groceries')).slice((req.params.page - 1) * 10, (req.params.page) * 10);
            if (data.length > 0) {
              console.log(`<redis hit>`)
              res.json(data.map(item => JSON.parse(item)));
              return;
            }
            data = await sanityClient.fetch(`*[_type=="product" && category=="groceries"][${(req.params.page - 1) * 10}...${req.params.page * 10}]
            {
             ...,
          'quantity':quantity[pincode == '${req.params.pincode}'][0].quantity,
            'seller':null
            }`);
            let deserializeDatum: ProductType;
            for (let datum of data) {
              deserializeDatum = datum as unknown as ProductType;
              redisClient.hSet("products:groceries", deserializeDatum._id, JSON.stringify(datum));
            }
            res.json(data);
            return;
          }
          case 'gadgets': {
            let data: string[] = (await redisClient.hVals('products:gadgets')).slice((req.params.page - 1) * 10, (req.params.page) * 10);
            if (data.length > 0) {
              console.log(`<redis hit>`)
              res.json(data.map(item => JSON.parse(item)));
              return;
            }
            data = await sanityClient.fetch(`*[_type=="product" && category=="gadgets"][${(req.params.page - 1) * 10}...${req.params.page * 10}]{
             ...,
            'quantity':quantity[pincode == '${req.params.pincode}'][0].quantity,
            'seller':null
            }`);
            let deserializeDatum: ProductType;
            for (let datum of data) {
              deserializeDatum = datum as unknown as ProductType;
              redisClient.hSet("products:gadgets", deserializeDatum._id, JSON.parse(datum));
            }
            res.json(data);
            return;
          }

          case 'toys': {
            let data: string[] = (await redisClient.hVals('products:toys')).slice((req.params.page - 1) * 10, (req.params.page) * 10);
            if (data.length > 0) {
              console.log(`<redis hit>`)
              res.json(data.map(item => JSON.parse(item)));
              return;
            }
            data = await sanityClient.fetch(`*[_type=="product" && category=="toys"][${(req.params.page - 1) * 10}...${req.params.page * 10}]{
             ...,
            'quantity':quantity[pincode == '${req.params.pincode}'][0].quantity,
            'seller':null
            }`);
            let deserializeDatum: ProductType;
            for (let datum of data) {
              deserializeDatum = datum as unknown as ProductType;
              redisClient.hSet("products:toys", deserializeDatum._id, JSON.parse(datum));
            }
            res.json(data);
            return;
          }

          case 'clothes': {
            let data: string[] = (await redisClient.hVals('products:clothes')).slice((req.params.page - 1) * 10, (req.params.page) * 10);
            if (data.length > 0) {
              console.log(`<redis hit>`)
              res.json(data.map(item => JSON.parse(item)));
              return;
            }
            data = await sanityClient.fetch(`*[_type=="product" && category=="clothes"][${(req.params.page - 1) * 10}...${req.params.page * 10}]{
             ...,
            'quantity':quantity[pincode == '${req.params.pincode}'][0].quantity,
            'seller':null
            }`);
            let deserializeDatum: ProductType;
            for (let datum of data) {
              deserializeDatum = datum as unknown as ProductType;
              redisClient.hSet("products:clothes", deserializeDatum._id, JSON.parse(datum));
            }
            res.json(data);
            return;
          }

        }
      }
      switch (req.params.category) {
        case 'all': res.json(await sanityClient.fetch(`*[_type=="product"][${(req.params.page - 1) * 10}...${req.params.page * 10}]{
             ...,
            'quantity':quantity[pincode == '${req.params.pincode}'][0].quantity,
            'seller':null
            }`));
          break;
        case 'groceries': res.json(await sanityClient.fetch(`*[_type=="product" && category=="groceries"][${(req.params.page - 1) * 10}...${req.params.page * 10}]{
             ...,
           'quantity':quantity[pincode == '${req.params.pincode}'][0].quantity,
            'seller':null
            }`));
          break;
        case 'gadgets': res.json(await sanityClient.fetch(`*[_type=="product" && category=="gadgets"][${(req.params.page - 1) * 10}...${req.params.page * 10}]{
             ...,
            'quantity':quantity[pincode == '${req.params.pincode}'][0].quantity,
            'seller':null
            }`));
          break;
        case 'toys': res.json(await sanityClient.fetch(`*[_type=="product" && category=="toys"][${(req.params.page - 1) * 10}...${req.params.page * 10}]{
             ...,
           'quantity':quantity[pincode == '${req.params.pincode}'][0].quantity,
            'seller':null
            }`));
          break;
        case 'clothes': res.json(await sanityClient.fetch(`*[_type=="product" && category=="clothes"][${(req.params.page - 1) * 10}...${req.params.page * 10}]{
             ...,
            'quantity':quantity[pincode == '${req.params.pincode}'][0].quantity,
            'seller':null
            }`));
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
            if (redisClient.isOpen) {
              const fromRedisResult = await redisClient.hGet('products:details', productId)
              if (fromRedisResult) {
                res.send(200).json(JSON.parse(fromRedisResult));
                return;
              }
            }
            const result: ProductType = await sanityClient.fetch(`*[_type=='product' && _id=='${productId}'][0]`);
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
      // ClerkExpressRequireAuth(),
      authMiddleware,
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
      // ClerkExpressRequireAuth(),
      authMiddleware,
      async (req: Request<{}, {}, ProductType>, res: Response) => {
        const { _id, imagesBase64, } = req.body;
        const producer = kafka.producer();
        try {
          await producer.connect();
          producer.send({
            topic: 'update-product-topic',
            messages: [{ value: JSON.stringify(req.body) }]
          })
        } catch (err) {

        } finally {
          await producer.disconnect();
        }



      });

    app.listen(process.env.PORT ?? 5002, () =>
      console.log("listening on PORT:" + process.env.PORT)
    );
  }
  main();
}
