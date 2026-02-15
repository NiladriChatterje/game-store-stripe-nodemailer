import { Kafka } from "kafkajs";

const kafka = new Kafka({
  clientId: "xv-store",
  brokers: ["127.0.0.1:9095", "127.0.0.1:9096", "127.0.0.1:9097"],
  connectionTimeout: 10000,
  authenticationTimeout: 10000,
  retry: {
    retries: 5,
  },
});

async function admin() {
  const admin = kafka.admin({
    retry: {
      retries: 5,
    },
  });
  console.log("Connecting to admin...");
  await admin.connect();
  console.log("Connected successfully!");
  try {
    console.log("Listing topics...");
    console.log(await admin.listTopics());


    //admin-create-topic
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
      });

    // customer-order-notification-topic
    await admin
      .createTopics({
        topics: [
          {
            topic: "customer-order-notification-topic",
            numPartitions: 6,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 60000,
      });
    // user-create-topic
    await admin
      .createTopics({
        topics: [
          {
            topic: "user-create-topic",
            numPartitions: 6,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 60000,
      })

    // user-update-topic
    await admin
      .createTopics({
        topics: [
          {
            topic: "user-update-topic",
            numPartitions: 6,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 60000,
      })

    // 'subscription-notifications'
    await admin
      .createTopics({
        topics: [
          {
            topic: "subscription-notifications",
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
            topic: "add-product-topic",
            numPartitions: 5,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 60000,
      })

    await admin
      .createTopics({
        topics: [
          {
            topic: "update-product-topic",
            numPartitions: 5,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 60000,
      })

    await admin
      .createTopics({
        topics: [
          {
            topic: "update-product-quantity-topic",
            numPartitions: 5,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 60000,
      })

    await admin
      .createTopics({
        topics: [
          {
            topic: "product-quantity-reduction-topic",
            numPartitions: 5,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 60000,
      })

    await admin
      .createTopics({
        topics: [
          {
            topic: "admin-subscriptions-topic",
            numPartitions: 5,
            replicationFactor: 3,
          },
        ],
        waitForLeaders: true,
        timeout: 60000,
      })

    await admin.createTopics({
      topics: [{
        topic: 'subscription-notifications',
        numPartitions: 6,
        replicationFactor: 3,
      }],
      waitForLeaders: true,
      timeout: 60000,
    });
    // await admin
    //   .deleteTopics({ topics: ["product-topic", "product-db-save-topic"] })

  } catch (err: Error | any) {
    console.error(err?.message);
  } finally {
    await admin.disconnect();
  }
}

admin();
