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
  // Limit workers and remove zombie ping process
  const numWorkers = Math.min(availableParallelism(), 4);
  const restartCount = new Map<number, { count: number; lastRestart: number }>();
  const MAX_RESTART_ATTEMPTS = 5;
  const RESTART_WINDOW_MS = 30000;
  const restartBackoff = (workerId: number) => {
    const record = restartCount.get(workerId) || { count: 0, lastRestart: 0 };
    const now = Date.now();
    if (now - record.lastRestart > RESTART_WINDOW_MS) {
      record.count = 0;
    }
    record.count++;
    record.lastRestart = now + 1000;
    restartCount.set(workerId, record);
    if (record.count > MAX_RESTART_ATTEMPTS) {
      console.error(`Worker ${workerId} exceeded max restart attempts, not restarting`);
      return;
    }
    setTimeout(() => {
      const p = cluster.fork();
      p.on("exit", (code: number | null) => {
        if (code !== 0) {
          setTimeout(() => restartBackoff(p.id), 1000);
        }
      });
    }, 1000);
  };

  let p;
  for (let i = 0; i < numWorkers; i++) {
    p = cluster.fork();

    p.on("exit", (code: number | null) => {
      if (code !== 0) {
        setTimeout(() => restartBackoff(p.id), 1000);
      }
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
    brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
  });


  try {
    await redisClient.connect();
    console.log("<<redis connected successfully>>");
  } catch (err) {
    console.log("<<redis connection failed>>", (err as Error)?.message);
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
        await producer.send({
          topic: 'user-create-topic',
          messages: [{ value: JSON.stringify(req.body) }]
        });
        res.status(201).json({ message: 'User creation queued' });
      } catch (err: Error | any) {
        console.log("<<error>> :", err.message);
        res.status(500).json({ error: 'Failed to create user' });
      } finally {
        await producer.disconnect().catch(() => {});
      }
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
          // FIXED: was checking `redisClient != null` instead of `redisResult`
          if (redisResult != null) {
            console.log("<< redis hit - user-found >>");
            const deserialized = JSON.parse(redisResult)
            console.log(deserialized)
            res.json(deserialized)
            return;
          }
        }
        const result = await sanityClient.fetch<UserType>(`*[_type=="user" && _id == $id][0]`, {
          id: req.params._id
        })
        console.log(result);
        if (!result) {
          res.status(404).json({ error: 'User not found' });
          return;
        }
        res.json(result)
      } catch (e: Error | any) {
        res.status(500).json({ error: e.message })
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
          // FIXED: was checking `redisClient != null` instead of `redisResult`
          if (redisResult != null) {
            console.log("<< redis hit - user-cart >>");
            const deserialized = JSON.parse(redisResult)
            console.log(deserialized)
            res.json(deserialized)
            return;
          }
        }
        const result = await sanityClient.fetch(`*[_type=="user_cart" && user_id == $id][0]`, {
          id: req.params._id
        });
        if (result && redisClient.isOpen) {
          await redisClient.hSet(`hashSet:user:cart`, req.params._id, JSON.stringify(result));
        }
        console.log(result)
        res.json(result || { cart: [] })
      } catch (e: Error | any) {
        res.status(500).json({ error: e.message })
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
          *[_type=="order" && customer._ref == $userId && status in ["orderPlaced", "dispatched", "shipping", "shipped"]] {
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
      worker.on("error", (err) => {
        console.error("UpdateInfo worker error:", err);
      });
      res.status(200).json({ message: 'Update queued' });
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
    worker.on("error", (err) => {
      console.error("Email worker error:", err);
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