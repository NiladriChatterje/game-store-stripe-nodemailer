import { Kafka, Consumer } from "kafkajs";
import { sanityConfig } from "./utils";
import { createClient } from "@sanity/client";

const kafka: Kafka = new Kafka({
  clientId: "xv-store",
  brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
});

async function updateAdminRecord() {
  const sanityClient = createClient(sanityConfig);
  const consumer: Consumer = kafka.consumer({ groupId: "update-admin-record" });
  await consumer.connect();
  await consumer.subscribe({ topic: "admin-update-topic" });
}
