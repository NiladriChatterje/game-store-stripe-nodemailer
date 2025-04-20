import { Kafka } from "kafkajs";
import { workerData } from "worker_threads";
import { AdminFieldsType } from "./delcarations/AdminFieldType";

const kafka = new Kafka({
  clientId: "xv store",
  brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
});

//admin update info
async function updateInfo(adminPayload: AdminFieldsType) {
  const producer = kafka.producer();
  await producer.connect();

  producer.send({
    topic: "admin-update-topic",
    messages: [{ value: JSON.stringify(adminPayload) }],
  });

  await producer.disconnect();
}

updateInfo(workerData.adminPayload);
