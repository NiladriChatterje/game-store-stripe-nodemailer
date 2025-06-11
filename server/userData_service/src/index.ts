import { Worker } from "worker_threads";
import cluster from "cluster";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { availableParallelism } from "os";
import type { UserType } from "../declaration/index.d.ts";
import { createClient, SanityClient } from '@sanity/client'
import { sanityConfig } from './utils/index.js';

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
  const app: Express = express();

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
    (req: Request<{}, UserType>, res: Response) => {

    }
  );

  app.get(
    "/fetch-user-data/:_id",
    (req: Request<{ _id: string }>, res: Response) => {
      console.log(req.params._id);
      const NotClonedObject = {
        workerData: {
          _id: req.params._id,
        },
      };
      const worker = new Worker("./dist/fetchAdminData.js", NotClonedObject);
      worker.on("message", (value) => {
        console.log(value);
        res.status(value.status).json(value.result);
      });

      worker.on("error", (err) => {
        res.status(503).send(err.message);
      });
    }
  );

  app.patch(
    "/update-info",
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
    const worker = new Worker("./dist/PhoneWorker.js", {
      workerData: {
        recipient: req.body?.phone,
        confirmation: OTP,
      },
    });

    res.send("SMS sent");
  });

  app.listen(process.env.PORT ?? 5001, () =>
    console.log("listening on PORT:" + process.env.PORT)
  );
}
