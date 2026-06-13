import { EachMessagePayload, Kafka } from "kafkajs";
import { createClient as RedisClient } from "redis";
import mysql from "mysql2/promise";
import { uuidv7 as uuid } from "uuidv7";
import { GLOBAL_DB_CONFIG } from "./utils/ShardRouter";

const kafka = new Kafka({
  clientId: "xvstore",
  brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});

interface DeliveryEventPayload {
  sellerOrderId: string;
  orderId: string;
  sellerId: string;
  pincode: string;
  amount: number;
  products: Array<{ productId: string; quantity: number; productName?: string }>;
  customerAddress?: string;
  timestamp?: string;
}

async function main() {
  const redisClient = RedisClient({
    url: "redis://redis_storage:6379",
  });
  await redisClient.connect();

  const globalPool = mysql.createPool({
    ...GLOBAL_DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });

  const consumer = kafka.consumer({
    groupId: "shipper-notification-group",
  });

  const producer = kafka.producer();
  await producer.connect();

  await consumer.connect();
  await consumer.subscribe({ topic: "shipper-delivery-event-topic" });

  async function handleMessage({
    heartbeat,
    message,
    partition,
    topic,
  }: EachMessagePayload) {
    console.log(
      `[ShipperNotificationConsumer] msg received topic=${topic} partition=${partition} offset=${message.offset}`
    );

    try {
      const event: DeliveryEventPayload = JSON.parse(
        message.value?.toString() || "{}"
      );

      const {
        sellerOrderId,
        orderId,
        sellerId,
        pincode,
        amount,
        products,
        customerAddress,
      } = event;

      if (!sellerOrderId || !pincode || !orderId || !sellerId) {
        console.warn("[ShipperNotificationConsumer] Invalid payload — missing required fields");
        return;
      }

      // 1. Find all shippers at this pincode
      const [shipperRows] = await globalPool.execute(
        `SELECT id FROM shippers WHERE address_pincode = ?`,
        [pincode]
      );

      const shippers = shipperRows as Array<{ id: string }>;

      if (shippers.length === 0) {
        console.log(`[ShipperNotificationConsumer] No shippers found at pincode ${pincode}`);
        return;
      }

      console.log(
        `[ShipperNotificationConsumer] Found ${shippers.length} shipper(s) at pincode ${pincode}`
      );

      const notificationId = uuid();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

      const notificationPayload = {
        id: notificationId,
        type: "new_delivery" as const,
        sellerOrderId,
        orderId,
        sellerId,
        pincode,
        amount,
        customerAddress: customerAddress || "",
        products,
        claimed: false,
        claimedBy: null,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };

      // 2. Create notification records for each shipper
      for (const shipper of shippers) {
        // Insert into MySQL (persistent)
        await globalPool.execute(
          `INSERT IGNORE INTO shipper_notifications
           (id, shipper_id, type, seller_order_id, order_id, seller_id, pincode, amount, payload, read_status, claim_status)
           VALUES (?, ?, 'new_delivery', ?, ?, ?, ?, ?, ?, 'unread', 'pending')`,
          [
            notificationId,
            shipper.id,
            sellerOrderId,
            orderId,
            sellerId,
            pincode,
            amount || 0,
            JSON.stringify(notificationPayload),
          ]
        );

        // LPUSH to Redis (real-time)
        if (redisClient.isOpen) {
          const redisKey = `shipper:notifications:${shipper.id}`;
          await redisClient.lPush(redisKey, JSON.stringify(notificationPayload));
          // Set TTL of 24 hours on the list
          await redisClient.expire(redisKey, 86400);
        }
      }

      // 3. Publish to shipper-notification-topic for SSE service
      await producer.send({
        topic: "shipper-notification-topic",
        messages: [
          {
            value: JSON.stringify({
              shipperIds: shippers.map((s) => s.id),
              notification: notificationPayload,
            }),
          },
        ],
      });

      console.log(
        `[ShipperNotificationConsumer] Notifications created for ${shippers.length} shipper(s) for sellerOrder ${sellerOrderId}`
      );

      await heartbeat();
      consumer.commitOffsets([{ topic, partition, offset: message.offset }]);
    } catch (error: any) {
      console.error("[ShipperNotificationConsumer] Error processing message:", {
        error: error?.message,
        stack: error?.stack,
      });
      try {
        consumer.commitOffsets([{ topic, partition, offset: message.offset }]);
      } catch (commitError) {
        console.error("[ShipperNotificationConsumer] Failed to commit offset:", commitError);
      }
    }
  }

  consumer.run({
    partitionsConsumedConcurrently: 3,
    eachMessage: handleMessage,
    autoCommit: false,
  });

  console.log("[ShipperNotificationConsumer] Listening on shipper-delivery-event-topic...");
}

main().catch(console.error);
