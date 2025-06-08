import { parentPort, workerData } from "node:worker_threads";
import dotenv from "dotenv";
import { Kafka, RecordMetadata } from "kafkajs";
import { ProductType } from "@declaration/index.js";

dotenv.config();

async function addProductData(workerData: ProductType) {
  try {
    const kafka: Kafka = new Kafka({
      clientId: "xv store",
      brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
      ssl: true,
    });

    const producer = kafka.producer();
    producer.connect();
    const recordMetaData: RecordMetadata[] = await producer.send({
      topic: "product-topic",
      messages: [{ value: JSON.stringify(workerData) }],
    });

    parentPort?.postMessage({ status: 200, value: recordMetaData });
    await producer.disconnect();
  } catch (e: Error | any) {
    parentPort?.postMessage({
      status: 500,
      value: e?.message,
    });
  }

}

addProductData(workerData);
