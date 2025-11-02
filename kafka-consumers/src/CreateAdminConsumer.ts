import { createClient, SanityClient } from "@sanity/client";
import { EachMessagePayload, Kafka } from "kafkajs";
import { sanityConfig } from "./utils/index.ts";
import type { AdminFieldsType } from "@declaration/AdminFieldType.d.ts";
import { createClient as redisClient } from "redis";

async function createAdmin() {
  const kafka = new Kafka({
    clientId: "xvstore",
    brokers: ["localhost:9095", "localhost:9096", "localhost:9097"],
  });

  const redisC = redisClient();
  await redisC.connect()
  const consumer = kafka.consumer({
    groupId: "admin-record",
    retry: { retries: 6 },
  });
  await consumer.connect();
  await consumer.subscribe({ topic: "admin-create-topic" });

  const sanityClient: SanityClient = createClient(sanityConfig);

  async function handleMessage({
    heartbeat,
    pause,
    topic,
    partition,
    message,
  }: EachMessagePayload) {
    const user: AdminFieldsType = JSON.parse(message.value.toString());
    console.log(user);
    if (user)
      sanityClient
        ?.createIfNotExists({
          _type: "admin",
          _id: `admin-${user._id}`, // Fix: Prefix admin IDs to avoid collision with user IDs
          username: user?.username,
          email: user?.email,
          geoPoint: {
            lat: user.geoPoint.lat,
            lng: user.geoPoint.lng,
          },
          address: {
            pincode: user.address.pincode,
            county: user.address.county,
            state: user.address.state,
            country: user.address.country,
          },
        })
        .then(async (onfulfilled) => {
          console.log(`<< data ${onfulfilled.username} written >>`);
          console.log("onfulfilled::\n", onfulfilled);
          console.log("Document type returned:", onfulfilled._type); // Debug log to verify type
          consumer
            .commitOffsets([{ topic, offset: message.offset, partition }])
            .then(async () => {
              await heartbeat(); // to let the broker know that the consumer in the group is still alive
            });
          await redisC.hSet(`hashSet:admin:details`, onfulfilled._id, JSON.stringify(onfulfilled));
          await redisC.sAdd(`set:admin:id`, onfulfilled.username);
        })
        .catch((err) => console.log(err));
  }

  consumer.run({
    autoCommit: false,
    eachMessage: handleMessage,
  });
}

createAdmin()