import { Worker } from "worker_threads";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import type { UserType } from "../declaration/index.d.ts";
import { createClient as RedisClient } from 'redis';
import { verifyToken } from "@clerk/backend";
import { JwtPayload } from "@clerk/types";
import { Kafka } from "kafkajs";
import mysql from 'mysql2/promise';

dotenv.config();

const GLOBAL_DB_CONFIG = {
    host: 'global_sql_data',
    port: 3306,
    user: 'root',
    password: '',
    database: 'xvstore'
};

declare global {
  namespace Express {
    interface Request {
      auth: NonNullable<JwtPayload | undefined>;
      userId: string;
    }
  }
}

const app: Express = express();
const redisClient = RedisClient({
  url: 'redis://redis_storage:6379'
});

const kafka = new Kafka({
  clientId: 'xv-store',
  brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});

// MySQL Global DB Pool
const globalPool = mysql.createPool({
  ...GLOBAL_DB_CONFIG,
  waitForConnections: true,
  connectionLimit: 2,
  queueLimit: 10
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
      clockSkewInMs: 300000
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
        if (redisResult != null) {
          console.log("<< redis hit - user-found >>");
          const deserialized = JSON.parse(redisResult)
          console.log(deserialized)
          res.json(deserialized)
          return;
        }
      }
      // Fetch from MySQL global DB
      const [rows] = await globalPool.execute(
        'SELECT * FROM users WHERE id = ?',
        [req.params._id]
      );
      const row = (rows as any[])[0];
      if (!row) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const result = {
        _id: row.id,
        username: row.username,
        email: row.email,
        phone: row.phone,
        geoPoint: row.geo_lat && row.geo_lng ? { lat: row.geo_lat, lng: row.geo_lng } : null,
        address: row.address_pincode ? {
          pincode: row.address_pincode,
          county: row.address_county,
          country: row.address_country,
          state: row.address_state
        } : null
      };
      console.log(result);
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
        if (redisResult != null) {
          console.log("<< redis hit - user-cart >>");
          const deserialized = JSON.parse(redisResult)
          console.log(deserialized)
          res.json(deserialized)
          return;
        }
      }
      // Fetch cart from MySQL
      const [cartRows] = await globalPool.execute(
        `SELECT uci.id, uci.product_id, uci.quantity
         FROM user_carts uc
         JOIN user_cart_items uci ON uc.id = uci.cart_id
         WHERE uc.user_id = ?`,
        [req.params._id]
      );
      const cart = cartRows as any[];
      const result = { cart: cart.map(item => ({ productId: item.product_id, quantity: item.quantity })) };

      if (result.cart.length > 0 && redisClient.isOpen) {
        await redisClient.hSet(`hashSet:user:cart`, req.params._id, JSON.stringify(result));
      }
      console.log(result)
      res.json(result)
    } catch (e: Error | any) {
      res.status(500).json({ error: e.message })
    }

    return;
  }
);

// Fetch delivery orders for a user
app.post(
  "/delivery-orders/:userId",
  verifyUserToken,
  async (req: Request<{ userId: string }>, res: Response) => {
    console.log("fetch-delivery-orders for user:", req.params.userId);
    try {
      // Query orders from MySQL
      const [orderRows] = await globalPool.execute(
        `SELECT o.id, o.order_id_display AS orderId, o.customer_id, o.shipper_id,
                o.quantity, o.transaction_id AS transactionId, o.payment_signature AS paymentSignature,
                o.amount, o.status, o.created_at AS _createdAt
         FROM orders o
         WHERE o.customer_id = ?
           AND o.status IN ('orderPlaced', 'dispatched', 'shipping', 'shipped')
         ORDER BY o.created_at DESC`,
        [req.params.userId]
      );

      const deliveryOrders = (orderRows as any[]).map(row => ({
        _id: row.id,
        orderId: row.orderId,
        quantity: row.quantity,
        transactionId: row.transactionId,
        paymentSignature: row.paymentSignature,
        amount: row.amount,
        status: row.status,
        _createdAt: row._createdAt,
        expectedDelivery: null
      }));

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