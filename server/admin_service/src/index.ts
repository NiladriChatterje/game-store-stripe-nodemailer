import { Worker } from "worker_threads";
import cluster from "cluster";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { availableParallelism } from "os";
import { AdminFieldsType } from "./delcarations/AdminFieldType";
import { getUserOrders } from "./FetchAdminProducts";

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
    "/create-admin",
    (req: Request<{}, AdminFieldsType>, res: Response) => {
      console.log(req.body);
      const NotClonedObject = {
        workerData: {
          value: req.body,
        },
      };
      let worker = new Worker("./dist/CreateAdmin.js", NotClonedObject);

      worker.on("message", (logLevel: { value: string; status: number }) => {
        console.log("<create Admin worker> : ", logLevel);
        res.status(logLevel.status).send(logLevel.value);
      });

      //respinning worker on failure
      worker.on("error", (_error: Error) => {
        console.log("<createAdmin-Worker-error>");
        console.log("<Restarting-another-createAdmin-Worker>");

        worker = new Worker("./dist/CreateAdmin.js", NotClonedObject);

        worker.on("message", (logLevel: { value: string; status: number }) => {
          console.log("<create Admin worker> : ", logLevel);
          res.status(logLevel.status).send(logLevel.value);
        });
      });
    }
  );

  app.get(
    "/fetch-admin-data/:_id",
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
      if (req.headers.authorization?.split(" "))
        next()
    },
    (req: Request<{}, {}, AdminFieldsType>, res: Response) => {
      const worker = new Worker("./dist/UpdateInfo.js", {
        workerData: {
          adminPayload: req.body,
        },
      });

      worker.on("message", (data) => { });
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
  });

  app.listen(process.env.PORT, () =>
    console.log("listening on PORT:" + process.env.PORT)
  );
}
