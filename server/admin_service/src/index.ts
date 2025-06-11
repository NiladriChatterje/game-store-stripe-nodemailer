import { Worker } from "worker_threads";
import cluster from "cluster";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { availableParallelism } from "os";
import { AdminFieldsType } from "./delcarations/AdminFieldType";
import { createClient, SanityClient } from '@sanity/client'
import { sanityConfig } from './utils/index.js';
import { Kafka, logLevel, Producer, RecordMetadata } from "kafkajs";

dotenv.config();

async function getUserOrders(
  adminId: string) {
  const sanityClient: SanityClient = createClient(sanityConfig);
  const result = await sanityClient.fetch(
    `[_type=="admin" && _id=="${adminId}"]{productReferenceAfterListing}`,
  )
  return result
}

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
    "/create-admin",
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

        const recordMetaData: RecordMetadata[] = await producer.sendBatch({
          topicMessages: [
            {
              topic: "admin-create-topic",
              messages: [{ value: JSON.stringify(value) }],
            },
          ],
        });

        producer.on("producer.network.request_timeout", (ev) => {
          res.status(503).
            json("session timeout! Couldn't create profile.")
        });

        await producer.disconnect();
      }
      catch (err) {

      };

    }
  );

  app.get(
    "/fetch-admin-data/:_id",
    async (req: Request<{ _id: string }>, res: Response) => {
      console.log(req.params._id);

      try {
        const result = await sanityClient?.fetch(
          `*[_type=='admin' && _id=='${req.params._id}']`
        );
        res.status(200).json(result);
      } catch (e) {
        res.status(500).json([]);
      }

    });


  app.patch(
    "/update-info",
    async (req: Request, res: Response, next: NextFunction) => {
      if (req.headers.authorization?.split(" ")[1])
        next()
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

  app.get(
    "/:_id/product-list",
    (req: Request<{ _id: string }>, res: Response) => {

      getUserOrders(req.params._id)
        .then(result => {
          res.status(200).send(result);
        })
        .catch(error => {
          res.status(500).send(error);
        })

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

  app.listen(process.env.PORT ?? 5003, () =>
    console.log("listening on PORT:" + process.env.PORT)
  );
}
