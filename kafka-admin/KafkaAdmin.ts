import { Kafka } from "kafkajs";

const kafka = new Kafka({
  clientId: "xv-store",
  brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
});

async function admin() {
  const admin = kafka.admin({
    retry: {
      retries: 5,
    },
  });
  await admin.connect();
  try {
    console.log(await admin.listTopics());


    // admin-create-topic
    await admin
      .createTopics({
        topics: [
          {
            topic: "admin-create-topic",
            numPartitions: 6,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 60000,
      })


    //admin-update-topic
    await admin
      .createTopics({
        topics: [
          {
            topic: "admin-update-topic",
            numPartitions: 5,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 60000,
      })


    //admin-update-topic
    await admin
      .createTopics({
        topics: [
          {
            topic: "product-topic",
            numPartitions: 5,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 60000,
      })

    // await admin
    //   .deleteTopics({ topics: ["product-embedding-topic", "product-db-save-topic"] })

  } catch (err: Error | any) {
    console.error(err?.message);
  } finally {
    await admin.disconnect();
  }
}

admin();
