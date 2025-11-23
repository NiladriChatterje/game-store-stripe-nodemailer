import { Worker } from "worker_threads";
import cluster from "cluster";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { availableParallelism } from "os";
import type { ProductType } from "@declaration/index.d.ts";
import { sanityConfig } from "@utils/index.js";
import { createClient as SanityClient } from "@sanity/client";
import { createClient as RedisClient, RedisClientType } from "redis";
import { spawn } from "child_process";
import { Kafka, RecordMetadata } from "kafkajs";
import { JwtPayload } from "@clerk/types";
import { verifyToken } from "@clerk/backend";
dotenv.config();

declare global {
  namespace Express {
    interface Request {
      auth: NonNullable<JwtPayload | undefined>;
      adminId: string;
    }
  }
}


if (cluster.isPrimary) {

  let old_child_process: any[] = []
  setInterval(() => {
    const child_process = spawn('ping', [
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
  const sanityClient = SanityClient(sanityConfig);
  const redisClient: RedisClientType = RedisClient({
    url: 'redis://redis_storage:6379'
  });
  //#region clerk_middleware
  const verifyClerkToken = async (req: Request<{}, {}, ProductType>, res: Response, next: NextFunction) => {
    try {
      // Get token from Authorization header
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        res.status(401).json({ error: 'No token provided' });
        return;
      }
      // Verify the token
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
        clockSkewInMs: 60000
      });
      // Add user info to request object
      req.auth = payload;
      next();
    } catch (error) {
      console.error('Token verification failed:', error);
      res.status(403).json({ error: 'Invalid token' });
      return;
    }
  };


  async function authMiddleware(req: Request<{}, {}, any>, res: Response, next: NextFunction) {
    const token = req.headers['x-admin-id'];
    if (!token) {
      res.status(401).send('Missing token!');
      return;
    }
    let result;
    result = (await redisClient.sIsMember(`set:admin:id`, token as unknown as string));
    if (result) {
      res.status(200).json(result);
      next();
      return;
    }
    result = await sanityClient.fetch(`count(*[_type=='admin' && _id=='${token as unknown as string}'])`)

    if (result && result > 0) {
      await redisClient.sAdd(`set:admin:id`, token);
      next();
    }
    else
      res.status(403).send('Unauthorized token!');
  }
  //#endregion

  async function main() {
    const app: Express = express();
    const kafka: Kafka = new Kafka({
      clientId: 'xv-store',
      brokers: ['localhost:9095', 'localhost:9096', 'localhost:9097']
    });
    await redisClient.connect();
    app.use(cors());
    app.use(express.json({ limit: "25mb" }));
    app.use(express.urlencoded({ extended: true, limit: "25mb" }));
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      next();
    });



    app.get("/", async (req: Request, res: Response) => {
      res.end("pinged!");
    });

    //for all users [that's why no authentication middleware] <Completed> | Dont touch
    app.get("/fetch-products/:pincode/:category/:page",
      async (req: Request<{ category: string; page: number, pincode: number }>, res: Response) => {
        res.setHeader('Content-Type', 'application/json');

        if (redisClient.isOpen) {
          switch (req.params.category) {
            case 'all': {
              let data: string[] = (await redisClient.hVals(`products:all:${req.params.pincode}`))
                .slice((req.params.page - 1) * 10, (req.params.page) * 10);
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
              console.log(data)
              for (let datum of data) {
                const deserializedData = datum as unknown as ProductType;
                redisClient.hSet(`products:all:${req.params.pincode}`, deserializedData._id, JSON.stringify(datum));
              }

              res.json(data);
              return;
            }

            default: {
              let data: string[] = (await redisClient.hVals(`products:${req.params.category}:${req.params.pincode}`))
                .slice((req.params.page - 1) * 10, (req.params.page) * 10);
              if (data.length > 0) {
                console.log(`<redis hit>`)
                res.json(data.map(item => JSON.parse(item)));
                return;
              }
              data = await sanityClient.fetch(`*[_type=="product" && category=="${req.params.category}"][${(req.params.page - 1) * 10}...${req.params.page * 10}]
            {
             ...,
          'quantity':quantity[pincode == '${req.params.pincode}'][0].quantity,
            'seller':null
            }`);
              let deserializeDatum: ProductType;
              for (let datum of data) {
                deserializeDatum = datum as unknown as ProductType;
                redisClient.hSet(`products:${req.params.category}:${req.params.pincode}`, deserializeDatum._id, JSON.stringify(datum));
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
          default: res.json(await sanityClient.fetch(`*[_type=="product" && category=="${req.params.category}"][${(req.params.page - 1) * 10}...${req.params.page * 10}]{
             ...,
           'quantity':quantity[pincode == '${req.params.pincode}'][0].quantity,
            'seller':null
            }`));
            break;
        }
      });

    //fetch particular product info for user display
    app.get(
      "/fetch-product-detail/:pincode/:productId",
      async (
        req: Request<{ productId: string; pincode: string }>,
        res: Response
      ) => {
        res.setHeader("Content-Type", "application/json");
        const pincode = req.params.pincode;
        const productId: string | undefined = req.params.productId
        if (productId) {
          try {
            if (redisClient.isOpen) {
              const fromRedisResult = await redisClient.hGet('products:details', productId)
              if (fromRedisResult) {
                res.status(200).json(JSON.parse(fromRedisResult));
                return;
              }
            }
            const result: ProductType = await sanityClient.fetch(`*[_type=='product' && _id=='${productId}'][0]{
              _id,
              _rev,
              productName,
              productDescription,
              modelNumber,
              category,
              imagesBase64,
              eanUpcNumber,
              price,
              "quantity":quantity[pincode == "${pincode}"][0].quantity
              }`);
            res.status(200).json(result);
            return;
          }
          catch (err) {
            console.log(err)
            res.status(502).json({ error: "Service down!" });
            return;
          }
        }
      }
    );

    //just fetch the quantity of the product in that location
    app.get(
      "/fetch-product-quantity/:pincode/:productId",
      async (req: Request<{ productId: string; pincode: string }>, res: Response, next: NextFunction) => {
        const productId: string | undefined = req.params.productId
        const pincode = req.params.pincode
        if (productId) {
          try {
            if (redisClient.isOpen) {
              console.log("inside redis")
              const fromRedisResult = (await redisClient.hGet('products:details', productId))
              const deserialized = fromRedisResult != null && JSON.parse(fromRedisResult)

              if (deserialized != null) {
                for (let quant of deserialized.quantity)
                  if (quant["pincode"] == pincode) {
                    res.status(200).json(quant);
                    return;
                  }
              }
            }
            const result: ProductType = await sanityClient.fetch(`*[_type=='product' && _id=='${productId}'][0]
                                          {"quantity":quantity[pincode=="700135"][0]{quantity}}`);
            res.status(200).send(result);
            return;
          }
          catch (err) {
            res.status(502).json({ error: "Service down!" });
            return;
          }
        }
      })
    //post to kafka topic [product-topic] to create the product
    app.post(
      "/add-product",
      verifyClerkToken,
      authMiddleware,
      async (req: Request<{}, {}, ProductType>, res: Response) => {
        const producer = kafka.producer();
        try {
          console.log(req.body)
          await producer.connect();
          const recordMetaData: RecordMetadata[] = await producer.send({
            topic: "add-product-topic",
            messages: [{ value: JSON.stringify(req.body) }],
          });
        } catch (err) {
          res.status(500).send({ err })
        }
        finally {
          await producer.disconnect();
        }
      }
    );

    //patch to update same product
    app.patch("/update-product",
      verifyClerkToken,
      authMiddleware,
      async (req: Request<{}, {}, ProductType>, res: Response) => {
        const producer = kafka.producer();
        try {
          await producer.connect();
          producer.send({
            topic: 'update-product-topic',
            messages: [{ value: JSON.stringify(req.body) }]
          });

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
