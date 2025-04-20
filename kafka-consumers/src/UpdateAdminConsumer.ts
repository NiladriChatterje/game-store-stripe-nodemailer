import { Kafka, Consumer, EachMessagePayload } from "kafkajs";
import { sanityConfig } from "./utils";
import { createClient } from "@sanity/client";
import { AdminFieldsType } from "@declaration/AdminFieldType";

const kafka: Kafka = new Kafka({
  clientId: "xv-store",
  brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
});

async function updateAdminRecord() {
  const sanityClient = createClient(sanityConfig);
  const consumer: Consumer = kafka.consumer({
    groupId: "update-admin-record",
    retry: { retries: 5 },
  });
  await consumer.connect();
  await consumer.subscribe({ topic: "admin-update-topic" });

  async function handleMessage({
    heartbeat,
    pause,
    partition,
    topic,
    message,
  }: EachMessagePayload) {
    console.log(message.value.toString());

    const {
      _id,
      gstin,
      address: { pinCode, county, country, state },
      email,
      phone,
    }: AdminFieldsType = JSON.parse(message.value.toString());
    let retry = true;

    try {
      while (retry)
        sanityClient
          ?.patch(_id)
          .set({
            gstin,
            address: {
              pinCode,
              county,
              country,
              state,
            },
            email,
            phone: Number(phone),
          })
          .commit()
          .then((_) => {
            heartbeat();
            retry = false;
          })
          .catch((_err) => {
            throw Promise.reject();
          });
    } catch (e) {}
  }

  consumer.run({ eachMessage: handleMessage });
}
