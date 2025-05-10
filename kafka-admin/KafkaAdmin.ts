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

    //product topic for DB
    await admin
      .createTopics({
        topics: [
          {
            topic: "product-db-save-topic",
            numPartitions: 5,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 120000,
      })
    // .then((result: boolean) => {
    //   // if (!result) throw new Error("<product-topic-creation-failed>");
    // })
    // .catch((err: Error) => console.log("<failed! Might be created earlier> or ",
    //   err.message));

    //product topic for Embeddings
    await admin
      .createTopics({
        topics: [
          {
            topic: "product-embedding-topic",
            numPartitions: 5,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 120000,
      })
    // .then((result: boolean) => {
    //   // if (!result) throw new Error("<product-topic-creation-failed>");
    // })
    // .catch((err: Error) => console.log("<failed! Might be created earlier> or ",
    //   err.message));

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
    // .then((result: boolean) => {
    //   if (!result) throw new Error("<admin-topic-creation-failed>");
    // })
    // .catch((err: Error) => console.log("<failed! Might be created earlier> or ",
    //   err.message));

    //admin-update-topic
    admin
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
      .then((result: boolean) => {
        if (!result) throw new Error("<product-topic-creation-failed>");
      })
      .catch((err: Error) => console.log("<failed! Might be created earlier> or ",
        err.message));

    //admin-update-topic
    admin
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
      .then((result: boolean) => {
        if (!result) throw new Error("<product-topic-creation-failed>");
      })
      .catch((err: Error) => console.log("<failed! Might be created earlier> or ",
        err.message));

    // admin
    //   .deleteTopics({ topics: ["product-embedding-topic", "product-db-save-topic"] })
    //   .then((topic) => topic + " successfully deleted")
    //   .catch((err) => "<No such Topic to delete>");
  } catch (err: Error | any) {
    console.error(err?.message);
  } finally {
    await admin.disconnect();
  }
}

admin();
