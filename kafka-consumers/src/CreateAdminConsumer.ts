import { createClient, SanityClient } from "@sanity/client";
import { EachMessagePayload, Kafka } from "kafkajs";
import { sanityConfig } from "./utils/index.ts";
import type { AdminFieldsType } from "@declaration/AdminFieldType.d.ts";
import { createClient as redisClient } from "redis";

async function createAdmin() {
  const kafka = new Kafka({
    clientId: "xvstore",
    brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
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
          _id: user._id,
          username: user?.username,
          email: user?.email,
          geoPoint: {
            lat: user.geoPoint.lat,
            lng: user.geoPoint.lng,
          },
          address: {
            pinCode: user.address.pinCode,
            county: user.address.county,
            state: user.address.state,
            country: user.address.country,
          },
        })
        .then(async (onfulfilled) => {

          console.log(`<< data ${onfulfilled.username} written >>`);
          consumer
            .commitOffsets([{ topic, offset: message.offset, partition }])
            .then(async () => {
              await heartbeat(); // to let the broker know that the consumer in the group is still alive
            });
          await redisC.hSet(`hashSet:admin:details`, onfulfilled._id, JSON.stringify(onfulfilled));
          await redisC.sadd(`set:admin:id`, onfulfilled.username);
        })
        .catch((err) => console.log(err));
  }

  consumer.run({
    autoCommit: false,
    eachMessage: handleMessage,
  });
}

createAdmin()