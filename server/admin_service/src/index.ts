import { Worker } from "worker_threads";
import cluster from "cluster";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { availableParallelism } from "os";
import { AdminFieldsType } from "./delcarations/AdminFieldType";
import { createClient, SanityClient } from '@sanity/client'
import { createClient as RedisClient } from "redis";
import { sanityConfig } from './utils/index.js';
import { Kafka, logLevel, Producer, RecordMetadata } from "kafkajs";
import { createTransport } from "nodemailer";
import { ClerkClient, verifyToken } from "@clerk/backend";
import { spawn } from 'node:child_process'
import { JwtPayload } from "@clerk/types";


dotenv.config();

//#region custom express.Request definition
declare module "express-serve-static-core" {
  interface Request {
    auth: NonNullable<JwtPayload | undefined>;
    userId: string;
  }
}
//#endregion

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
  const mailOption = {
    service: 'gmail',
    auth: {
      user: process.env.AUTH_EMAIL,
      pass: process.env.APP_KEY,
    },
  }
  const mailTransport = createTransport(mailOption);
  const kafka = new Kafka({
    clientId: "xv store",
    brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
    retry: {
      retries: 2,
    },
    logLevel: logLevel.ERROR,
    logCreator: (logEntry) => {
      return ({ namespace, level, label, log }) => {
        const { message, ...extra } = log;

      };
    },
  });
  const app: Express = express();
  const sanityClient: SanityClient = createClient(sanityConfig);
  const redisClient = RedisClient();
  try {
    await redisClient.connect();
  } catch (e: Error | any) {
    console.log("<error connecting redis server>");
    console.log(e.message)
  }

  app.use(cors());
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });

  //#region clerk_middleware
  const verifyClerkToken = async (req: Request<{}, {}, AdminFieldsType>, res: Response, next: NextFunction) => {
    try {
      // Get token from Authorization header
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        res.status(401).json({ error: 'No token provided' });
        return;
      }
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
        clockSkewInMs: 60000
      });

      req.auth = payload;
      next();
    } catch (error) {
      console.error('Token verification failed:', error);
      res.status(403).json({ error: 'Invalid token' });
      return;
    }
  };
  //#endregion


  //#region ENDPOINTS
  //ping self to keep server awake
  app.get("/", (req: Request, res: Response) => {
    res.end("pinged!");
  });

  //admin creation [kafka interaction]
  app.post(
    "/create-admin",
    verifyClerkToken,
    async (req: Request<{}, {}, AdminFieldsType>, res: Response) => {
      const value = req.body;

      console.log("<admin-data-received> : ", value);
      let producer: Producer;
      try {
        producer = kafka.producer({
          allowAutoTopicCreation: false,
          transactionTimeout: 60000,
        });

        await producer.connect();

        const recordMetaData: RecordMetadata[] = await producer.send({
          topic: "admin-create-topic",
          messages: [{ value: JSON.stringify(value) }],
        });

        producer.on("producer.network.request_timeout", (ev) => {
          res.status(503).
            json("session timeout! Couldn't create profile.")
        });

        res.status(201).send('Account will be created soon!')
        await producer.disconnect();
      }
      catch (err) {

      };
    }
  );


  //get admin credential [redis + sanity interaction]
  app.get(
    "/fetch-admin-data/:_id",
    verifyClerkToken,
    async (req: Request<{ _id: string }>, res: Response) => {
      console.log(req.params._id);
      try {
        if (redisClient.isOpen) {
          const result = await redisClient.hGet("hashSet:admin:details", req.params._id);
          if (result) {
            console.log("<Redis admin hit>")
            res.json(JSON.parse(result));
            return;
          }
        }
        const result = await sanityClient?.fetch(
          `*[_type=='admin' && _id=='${req.params._id}'][0]`
        );
        console.log(result)
        res.status(200).json(result);
        if (req.params._id.length > 0) {
          await redisClient.hSet("hashSet:admin:details", req.params._id, JSON.stringify(result));
          await redisClient.sAdd("set:admin:id", req.params._id)
        }
        return;
      } catch (e: Error | any) {
        res.status(500).json({ error: e.message });
      }
    });


  //update admin new data
  app.patch(
    "/update-admin-info",
    verifyClerkToken,
    async (req: Request<{}, {}, AdminFieldsType>, res: Response, next: NextFunction) => {
      if (redisClient.isOpen) {
        if (await redisClient.sIsMember('set:admin:id', req.body._id)) {
          next();
          return;
        }
      }
      //now watching if record is in sanity.io else catfishing
      const record = await sanityClient.fetch(`*[_type=="admin" && _id==$adminId][0]`, {
        adminId: req.body._id
      });

      if (record != null) {
        if (redisClient.isOpen) {
          await redisClient.hSet('hashSet:admin:details', req.body._id, JSON.stringify(record))
          await redisClient.sAdd('set:admin:id', req.body._id)
        }
        next();
        return;
      }

      res.sendStatus(401);
    },
    async (req: Request<{}, {}, AdminFieldsType>, res: Response) => {
      const adminPayload: AdminFieldsType = req.body;
      const producer = kafka.producer();
      await producer.connect();

      producer.send({
        topic: "admin-update-topic",
        messages: [{ value: JSON.stringify(adminPayload) }],
      });
      await producer.disconnect();
    }
  );

  //get product list uploaded by an admin [redis + sanity]
  app.get(
    "/:_id/product-list",
    verifyClerkToken,
    async (req: Request<{ _id: string }>, res: Response) => {
      try {
        if (redisClient.isOpen) {
          const resultFromRedis = await redisClient.lRange(`productList:admin:${req.params._id}`, 0, -1);
        }
        const sanityClient: SanityClient = createClient(sanityConfig);
        const result = await sanityClient.fetch(
          `*[_type=="admin" && _id==$admin_id]{productReferenceAfterListing}`, {
          admin_id: req.params._id
        }
        )
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send(error);
      }
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
    const worker = new Worker("./dist/PhoneWorker.js", {
      workerData: {
        recipient: req.body?.phone,
        confirmation: OTP,
      },
    });

    res.send("SMS sent");
  });
  //#endregion 


  app.listen(process.env.PORT ?? 5003, () =>
    console.log("listening on PORT:" + process.env.PORT)
  );
}
