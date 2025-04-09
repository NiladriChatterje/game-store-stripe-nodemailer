import { createClient, SanityClient } from "@sanity/client";
import { EachMessagePayload, Kafka } from "kafkajs";
import { sanityConfig } from "./utils";
import { AdminFieldsType } from "@declaration/AdminFieldType";

async function createAdmin() {
  const kafka = new Kafka({
    clientId: "xvstore",
    brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
  });

  const consumer = kafka.consumer({ groupId: "admin-record" });
  await consumer.connect();
  await consumer.subscribe({ topic: "create-admin-record" });

  const sanityClient: SanityClient = createClient(sanityConfig);

  async function handleMessage({
    heartbeat,
    pause,
    message,
    topic,
    partition,
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
        .then((onfulfilled) =>
          console.log(`<< data ${onfulfilled.username} written >>`)
        )
        .catch((err) => console.log(err));
  }

  consumer.run({
    eachMessage: handleMessage,
  });
}

createAdmin();

/*Structure sent while producing */
// sanityClient?.create({
// _type: 'admin',
// username: user?.firstName,
// adminId: user?.id,
// email: user?.emailAddresses[0].emailAddress,
// geoPoint: {
//   lat: latitude,
//   lng: longitude,
// },
// address: {
//   pinCode: placeResult?.properties?.postcode,
//   county: placeResult?.properties?.county,
//   state: placeResult?.properties?.state,
//   country: placeResult?.properties?.country,
// },
//   })
