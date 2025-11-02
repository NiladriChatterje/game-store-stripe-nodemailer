import { Kafka, Consumer, EachMessagePayload } from "kafkajs";
import { sanityConfig } from "./utils";
import { createClient } from "@sanity/client";
import { AdminFieldsType } from "@declaration/AdminFieldType";

const kafka: Kafka = new Kafka({
  clientId: "xv-store",
  brokers: ["localhost:9095", "localhost:9096", "localhost:9097"],
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
      address: { pincode, county, country, state },
      email,
      phone,
    }: AdminFieldsType = JSON.parse(message.value.toString());

    try {
      sanityClient
        ?.patch(_id)
        .set({
          gstin,
          address: {
            pincode,
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
        })
        .catch((_err) => {
          throw Promise.reject();
        });
    } catch (e) { }
  }

  consumer.run({ eachMessage: handleMessage });
}
