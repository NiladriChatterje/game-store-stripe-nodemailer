import { Worker } from "worker_threads";
import cluster from "cluster";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { availableParallelism } from "os";
import type { UserType } from "../declaration/index.d.ts";
import { createClient, SanityClient } from '@sanity/client'
import { sanityConfig } from './utils/index.js';
import { createClient as RedisClient } from 'redis';
import { verifyToken } from "@clerk/backend";
import { JwtPayload } from "@clerk/types";
import { spawn } from "child_process";
import { Kafka } from "kafkajs";

dotenv.config();

declare global {
  namespace Express {
    interface Request {
      auth: NonNullable<JwtPayload | undefined>;
      userId: string;
    }
  }
}

if (cluster.isPrimary) {
  let old_child_process: any[] = []
  setInterval(() => {
    const child_process = spawn('ping', [
      `http://localhost:${process.env.PORT ?? 5001}/`
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
  const app: Express = express();
  const sanityClient: SanityClient = createClient(sanityConfig);
  const redisClient = RedisClient({
    url: 'redis://redis_storage:6379'
  });

  const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ['localhost:9095', 'localhost:9096', 'localhost:9097']
  });


  try {
    ; (async () => { await redisClient.connect(); })();
  } catch (err) {
    console.log("<<redis connection failed>>");
  }

  const verifyUserToken = async (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.split(" ")[1];
    try {
      if (!token) {
        console.log('❌ No token provided in Authorization header');
        res.status(401).json({ error: 'No token provided' });
        return;
      }

      console.log('🔍 Verifying token:', token.substring(0, 20) + '...');

      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
        clockSkewInMs: 300000  // Increased from 60000 to 300000 (5 minutes) for Docker clock skew tolerance
      });

      console.log('Token verified successfully for user:', payload.sub);
      req.auth = payload;
      next();
    }
    catch (error) {
      console.error('Token verification failed:', {
        error: (error as Error)?.message,
        code: (error as any)?.code,
        stack: (error as Error)?.stack
      });
      res.status(403).json({ error: 'Invalid token' });
      return;
    }

  }
  app.use(cors());
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });

  app.get("/", (req: Request, res: Response) => {
    res.end("pinged!");
  });

  app.post(
    "/create-user",
    async (req: Request<{}, {}, UserType>, res: Response) => {
      console.log(req.body)
      const producer = kafka.producer();
      try {
        await producer.connect();

        producer.send({
          topic: 'user-create-topic',
          messages: [{ value: JSON.stringify(req.body) }]
        })
        await producer.disconnect();
      } catch (err: Error | any) {
        console.log("<<error>> :", err.message)
      }

      return;
    }
  );

  app.get(
    "/fetch-user-data/:_id",
    verifyUserToken,
    async (req: Request<{ _id: string }>, res: Response) => {
      console.log("fetch-user :", req.params._id);
      try {
        if (redisClient.isOpen) {
          const redisResult = await redisClient.hGet(`hashSet:user:details`, req.params._id);
          if (redisClient != null) {
            console.log("<< redis hit - user-found >>");
            const deserialized = JSON.parse(redisResult as string)
            console.log(deserialized)
            res.json(deserialized)
            return;
          }
        }
        const result = await sanityClient.fetch<UserType>(`*[_type=="user" && _id == $id][0]`, {
          id: req.params._id
        })
        console.log(result)
        res.json(result)
      } catch (e: Error | any) {
        res.json({ error: e.message })
      }

      return;
    }
  );

  //fetch cart of an user
  app.get(
    "/fetch-user-cart/:_id",
    verifyUserToken,
    async (req: Request<{ _id: string }>, res: Response) => {
      console.log("user_id :", req.params._id);
      try {
        if (redisClient.isOpen) {
          const redisResult = await redisClient.hGet(`hashSet:user:cart`, req.params._id);
          if (redisClient != null) {
            console.log("<< redis hit - user-cart >>");
            const deserialized = JSON.parse(redisResult as string)
            console.log(deserialized)
            res.json(deserialized)
            return;
          }
        }
        const result = await sanityClient.fetch(`*[_type=="user_cart" && user_id == $id][0]`, {
          id: req.params._id
        });
        await redisClient.hSet(`hashSet:user:cart`, req.params._id, JSON.stringify(result));
        console.log(result)
        res.json(result)
      } catch (e: Error | any) {
        res.json({ error: e.message })
      }

      return;
    }
  );

  // Fetch delivery orders for a user (orders with status: dispatched, shipping, shipped)
  app.post(
    "/delivery-orders/:userId",
    verifyUserToken,
    async (req: Request<{ userId: string }>, res: Response) => {
      console.log("fetch-delivery-orders for user:", req.params.userId);
      try {
        // Query orders from Sanity where customer references the user and status is dispatched, shipping, or shipped
        const deliveryOrders = await sanityClient.fetch(`
          *[_type=="order" && customer._ref == $userId && status in ["dispatched", "shipping", "shipped"]] {
            _id,
            customer->{
              _id,
              username,
              email,
              geoPoint,
              address,
              cart
            },
            product[]->{
              _id,
              productName,
              category,
              eanUpcIsbnGtinAsinType,
              eanUpcNumber,
              price,
              pincode,
              currency,
              imagesBase64,
              productDescription,
              quantity,
              keywords
            },
            quantity,
            transactionId,
            orderId,
            paymentSignature,
            amount,
            status,
            _createdAt,
            expectedDelivery
          } | order(_createdAt desc)
        `, {
          userId: req.params.userId
        });

        console.log(`Found ${deliveryOrders.length} delivery orders for user ${req.params.userId}`);
        res.json(deliveryOrders);
      } catch (error: Error | any) {
        console.error("Error fetching delivery orders:", error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  app.patch(
    "/update-user-info",
    verifyUserToken,
    async (req: Request, res: Response, next: NextFunction) => {
      if (req.headers.authorization?.split(" ")[1])
        next()
    },
    (req: Request<{}, {}, UserType>, res: Response) => {
      const worker = new Worker("./dist/UpdateInfo.js", {
        workerData: {
          adminPayload: req.body,
        },
      });

      worker.on("message", (data) => { });
    }
  );


  app.post("/fetch-mail-otp", (req: Request, res: Response) => {

    const OTP = Math.trunc(Math.random() * 10 ** 6);
    const worker = new Worker("./dist/EmailWorker.js", {
      workerData: {
        recipient: req.body?.recipient,
        confirmation: OTP,
      },
    });
    res.status(200).send("email sent successfully!")
  });

  app.post("/fetch-phone-otp", (req: Request, res: Response) => {
    const OTP = Math.trunc(Math.random() * 10 ** 6);

    res.send("SMS sent");
  });

  app.listen(process.env.PORT ?? 5001, () =>
    console.log("listening on PORT:" + process.env.PORT)
  );
}
