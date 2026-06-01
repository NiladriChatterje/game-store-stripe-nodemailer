import { parentPort, workerData } from "worker_threads";
import { Kafka } from "kafkajs";
import dotenv from "dotenv";
dotenv.config();

const kafka = new Kafka({
  clientId: "xv-store",
  brokers: [
    process.env.BROKER_HOST_1 ?? "kafka1:9092",
    process.env.BROKER_HOST_2 ?? "kafka2:9093",
    process.env.BROKER_HOST_3 ?? "kafka3:9094",
  ],
});

const producer = kafka.producer();

async function produce() {
  await producer.connect();
  await producer
    .send({
      topic: "seller-subscription-transaction",
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
