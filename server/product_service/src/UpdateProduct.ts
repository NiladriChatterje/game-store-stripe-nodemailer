import { Kafka, Producer } from "kafkajs";
import { SanityClient, createClient } from "@sanity/client";
import { sanityConfig } from "./utils/index.js";
import { parentPort, workerData } from "node:worker_threads";

const sanityClient: SanityClient = createClient(sanityConfig);
const kafka: Kafka = new Kafka({
  clientId: "xv-store",
  brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
});

const producer: Producer = kafka.producer();

async function main(producer: Producer, data: any) {
  try {
    await producer.connect();
    producer.send({
      topic: "admin-update-topic",
      messages: [{ value: JSON.stringify(data) }],
    });
    await producer.disconnect();

    parentPort?.postMessage({
      status: 204,
      value: "< Product updated successfully >",
    });
  } catch (e: Error | any) {
    parentPort?.postMessage({ status: 500, value: e?.message });
  }
}

main(producer, workerData);
