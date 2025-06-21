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
import { createTransport } from "nodemailer";
import { ClerkExpressRequireAuth } from "@clerk/clerk-sdk-node";
import { spawn } from 'node:child_process'


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

  app.use(cors());
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });

  //ping self to keep server awake
  app.get("/", (req: Request, res: Response) => {
    res.end("pinged!");
  });

  //admin creation [kafka interaction]
  app.post(
    "/create-admin",
    ClerkExpressRequireAuth(),
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


  //get admin credential
  app.get(
    "/fetch-admin-data/:_id",
    ClerkExpressRequireAuth(),
    async (req: Request<{ _id: string }>, res: Response) => {
      console.log(req.params._id);
      try {
        const result = await sanityClient?.fetch(
          `*[_type=='admin' && _id=='${req.params._id}'][0]`
        );
        res.status(200).json(result);
        return;
      } catch (e) {
        res.status(500).json({});
      }
    });


  //update admin new data
  app.patch(
    "/update-info",
    ClerkExpressRequireAuth(),
    async (req: Request<{}, {}, AdminFieldsType>, res: Response, next: NextFunction) => {

      //now watching if record is in sanity.io else catfishing
      const record = await sanityClient.fetch(`*[_type=="admin" && _id==$adminId][0]`, {
        adminId: req.body._id
      })
      next()

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

  //get product list uploaded by an admin
  app.get(
    "/:_id/product-list",
    async (req: Request<{ _id: string }>, res: Response) => {
      try {
        const sanityClient: SanityClient = createClient(sanityConfig);
        const result = await sanityClient.fetch(
          `[_type=="admin" && _id=="${req.params._id}"]{productReferenceAfterListing}`,
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

  app.listen(process.env.PORT ?? 5003, () =>
    console.log("listening on PORT:" + process.env.PORT)
  );
}
