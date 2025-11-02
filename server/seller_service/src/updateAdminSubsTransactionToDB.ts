import { parentPort, workerData } from "worker_threads";
import { Kafka } from "kafkajs";
import { SanityClient, createClient } from "@sanity/client";
import dotenv from "dotenv";
import { sanityConfig } from "@utils/index.js";
dotenv.config();

const sanityClient: SanityClient = createClient(sanityConfig);
const kafka = new Kafka({
  clientId: "xv-store",
  brokers: [
    process.env.BROKER_HOST_1 ?? "localhost:9095",
    process.env.BROKER_HOST_2 ?? "localhost:9096",
    process.env.BROKER_HOST_3 ?? "localhost:9097",
  ],
});

const producer = kafka.producer();

async function produce() {
  await producer.connect();
  await producer
    .send({
      topic: "admin-subscription-transaction",
      messages: [{ value: JSON.stringify(workerData) }],
    })

  await producer.disconnect()
}

produce()
  .then(() => {
    parentPort?.postMessage({ status: 200, msg: "Produced successfully" });
  })
  .catch(() => {
    parentPort?.postMessage({
      status: 500,
      msg: "Error while producing message!",
    });
  });
