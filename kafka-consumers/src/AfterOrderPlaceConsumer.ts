import { EachMessagePayload, Kafka } from "kafkajs";
import { createClient as RedisClient } from "redis";
import mysql from "mysql2/promise";
import { uuidv7 as uuid } from "uuidv7";

// MySQL connection/sharding helpers are implemented in other consumers via ShardRouter.
// If you want AFTER-ORDER to be shard-aware, we can extend it later.
// For now (logic option B), we use global DB writes + product_quantities/seller_product_details reads.
import { GLOBAL_DB_CONFIG, PRODUCT_SHARDS_CONFIG } from "./utils/ShardRouter";
import { PRODUCT_SHARDS_CONFIG as SHARDS } from "./utils/ShardRouter";
import { ShardHelper } from "./utils/ShardHelper";

const kafka: Kafka = new Kafka({
  clientId: "xvstore",
  brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});


async function main() {
  const redisClient = RedisClient({
    url: "redis://redis_storage:6379",
  });
  await redisClient.connect();

  // Global pool for orders + seller_orders + refunds
  const globalPool = mysql.createPool({
    ...GLOBAL_DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });

  // Shard pools for inventory (seller_product_details)
  const shardPools = PRODUCT_SHARDS_CONFIG.map((cfg) =>
    mysql.createPool({
      ...cfg,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    })
  );

  const consumer = kafka.consumer({
    groupId: "product-quantity-reduction",
  });

  await consumer.connect();
  await consumer.subscribe({ topic: "update-product-quantity-topic" });

  async function handleEachMessages({
    heartbeat,
    message,
    partition,
    topic,
  }: EachMessagePayload) {
    console.log(
      `[after-order-place-consumer] msg received topic=${topic} partition=${partition} offset=${message.offset} valueBytes=${message.value?.length ?? 0}`
    );

    try {
      const productPayload = JSON.parse(message.value?.toString() || "{}") as {
        customer: string;
        customerEmail: string;
        product: string; // product_id
        transactionId: string;
        orderId: string;
        geoPoint: { lat: number; lng: number };
        pincode: number;
        paymentSignature: string;
        amount: number;
        quantity: number;
      };

      const pincodeStr = String(productPayload.pincode).trim();
      const productId = productPayload.product;

      const unitPrice = productPayload.amount / productPayload.quantity;

      // Determine shard by pincode
      const shardIndex = ShardHelper.getShardIndex(productPayload.pincode);
      const inventoryPool = shardPools[shardIndex];

      const createdOrderId = uuid();

      const [orderInsertResult] = await globalPool.execute(
        `INSERT INTO orders (
          id, order_id_display, customer_id, quantity,
          transaction_id, payment_signature, amount, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createdOrderId,
          productPayload.orderId,
          productPayload.customer,
          productPayload.quantity,
          productPayload.transactionId,
          productPayload.paymentSignature,
          productPayload.amount,
          "orderPlaced",
        ] as any[]
      );

      let remainingQuantity = productPayload.quantity;
      let fulfilledQuantity = 0;
      let totalFulfilledAmount = 0;

      // Seller selection option B: fulfill from available stock for product + pincode,
      // without geo distance ordering.
      const [sellerRows] = await inventoryPool.execute(
        `SELECT id, seller_id, quantity
         FROM seller_product_details
         WHERE product_id = ? AND pincode = ? AND quantity > 0
         ORDER BY quantity DESC`,
        [productId, pincodeStr] as any[]
      );

      const sellers = sellerRows as Array<{
        id: string;
        seller_id: string;
        quantity: number;
      }>;

      const assignedSellers: Array<{
        sellerId: string;
        sellerProductDetailsId: string;
        quantity: number;
        amount: number;
      }> = [];

      for (const s of sellers) {
        if (remainingQuantity <= 0) break;

        const quantityFromThisSeller = Math.min(s.quantity, remainingQuantity);
        if (quantityFromThisSeller <= 0) continue;

        const amountFromThisSeller = quantityFromThisSeller * unitPrice;

        assignedSellers.push({
          sellerId: s.seller_id,
          sellerProductDetailsId: s.id,
          quantity: quantityFromThisSeller,
          amount: amountFromThisSeller,
        });

        fulfilledQuantity += quantityFromThisSeller;
        totalFulfilledAmount += amountFromThisSeller;
        remainingQuantity -= quantityFromThisSeller;
      }

      const isPartialFulfillment =
        fulfilledQuantity > 0 && fulfilledQuantity < productPayload.quantity;

      const refundAmount = (productPayload.quantity - fulfilledQuantity) * unitPrice;

      const kafkaProducer = kafka.producer();
      await kafkaProducer.connect();

      if (assignedSellers.length > 0) {
        // Track unique sellers for seller_to_shards update
        const sellerIdsForShard = new Set<string>();

        // Use the same shard pool as inventory — seller_orders lives alongside products
        const shardHost = `mysql${shardIndex + 1}`;

        // Create seller_orders + seller_order_items and decrement stock
        for (const assignment of assignedSellers) {
          const sellerOrderId = uuid();
          sellerIdsForShard.add(assignment.sellerId);

          // Write seller_orders to the CORRECT SHARD (not globalPool)
          await inventoryPool.execute(
            `INSERT INTO seller_orders (
              id, order_id, seller_id, pincode, status, total_amount, is_partial_fulfillment, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              sellerOrderId,
              createdOrderId,
              assignment.sellerId,
              pincodeStr,
              "pending",
              assignment.amount,
              isPartialFulfillment ? 1 : 0,
              isPartialFulfillment
                ? `Partial fulfillment: ${assignment.quantity} units.`
                : `Full fulfillment: ${assignment.quantity} units.`,
            ] as any[]
          );

          // Write seller_order_items to the CORRECT SHARD
          await inventoryPool.execute(
            `INSERT INTO seller_order_items (
              seller_order_id, product_id, quantity, price
            ) VALUES (?, ?, ?, ?)`,
            [
              sellerOrderId,
              productId,
              assignment.quantity,
              assignment.amount / assignment.quantity,
            ] as any[]
          );

          // Decrement inventory for this seller/product/pincode
          await inventoryPool.execute(
            `UPDATE seller_product_details
             SET quantity = GREATEST(0, quantity - ?)
             WHERE id = ?`,
            [assignment.quantity, assignment.sellerProductDetailsId] as any[]
          );

          // ✅ SEND NOTIFICATION TO SELLER VIA KAFKA
          await kafkaProducer.send({
            topic: "seller-order-notification-topic",
            messages: [
              {
                value: JSON.stringify({
                  notificationId: uuid(),
                  sellerOrderId,
                  orderId: createdOrderId,
                  sellerId: assignment.sellerId,
                  customerId: productPayload.customer,
                  productId,
                  quantity: assignment.quantity,
                  totalAmount: assignment.amount,
                  isPartialFulfillment,
                  status: "pending",
                  timestamp: new Date().toISOString(),
                  message: isPartialFulfillment
                    ? `New partial order: ${assignment.quantity} units`
                    : `New order: ${assignment.quantity} units`,
                }),
              },
            ],
          });
        }

        // Track seller → shard mapping so getSellerShards() can find data
        if (sellerIdsForShard.size > 0) {
          try {
            for (const sid of sellerIdsForShard) {
              await globalPool.execute(
                `INSERT IGNORE INTO seller_to_shards (seller_id, shard_host) VALUES (?, ?)`,
                [sid, shardHost]
              );
            }
          } catch (e) {
            console.warn(`[seller_to_shards tracking] failed: ${e}`);
          }
        }

        if (isPartialFulfillment) {
          await globalPool.execute(
            `UPDATE orders
             SET fulfilled_quantity = ?, refund_amount = ?, refund_status = ?, partial_fulfillment_reason = ?
             WHERE id = ?`,
            [
              fulfilledQuantity,
              refundAmount,
              "pending",
              `Partial fulfillment: only ${fulfilledQuantity}/${productPayload.quantity} units available.`,
              createdOrderId,
            ] as any[]
          );

          // Trigger refund process via Kafka
          await kafkaProducer.send({
            topic: "order-refund-topic",
            messages: [
              {
                value: JSON.stringify({
                  orderId: createdOrderId,
                  transactionId: productPayload.transactionId,
                  customerId: productPayload.customer,
                  customerEmail: productPayload.customerEmail,
                  refundAmount,
                  reason: `Partial fulfillment refund - ${remainingQuantity} units couldn't be fulfilled`,
                  originalAmount: productPayload.amount,
                  fulfilledAmount: totalFulfilledAmount,
                  fulfilledQuantity,
                  requestedQuantity: productPayload.quantity,
                }),
              },
            ],
          });

          await kafkaProducer.send({
            topic: "customer-order-notification-topic",
            messages: [
              {
                value: JSON.stringify({
                  notificationId: uuid(),
                  orderId: createdOrderId,
                  customerId: productPayload.customer,
                  customerEmail: productPayload.customerEmail,
                  productId,
                  quantity: fulfilledQuantity,
                  totalAmount: totalFulfilledAmount,
                  isPartialFulfillment: true,
                  refundAmount,
                  status: "processing",
                  timestamp: new Date().toISOString(),
                  message: `Your order is partially fulfilled. ${fulfilledQuantity}/${productPayload.quantity} items assigned. Refund of ₹${refundAmount.toFixed(
                    2
                  )} will be processed.`,
                }),
              },
            ],
          });
        }
      } else {
        // No sellers available -> full refund
        await globalPool.execute(
          `UPDATE orders
           SET fulfilled_quantity = 0, refund_amount = ?, refund_status = ?, partial_fulfillment_reason = ?
           WHERE id = ?`,
          [
            productPayload.amount,
            "pending",
            "No sellers available for product/pincode.",
            createdOrderId,
          ] as any[]
        );

        await kafkaProducer.send({
          topic: "order-refund-topic",
          messages: [
            {
              value: JSON.stringify({
                orderId: createdOrderId,
                transactionId: productPayload.transactionId,
                customerId: productPayload.customer,
                customerEmail: productPayload.customerEmail,
                refundAmount: productPayload.amount,
                reason: "Full refund - no sellers available",
                originalAmount: productPayload.amount,
                fulfilledAmount: 0,
                fulfilledQuantity: 0,
                requestedQuantity: productPayload.quantity,
              }),
            },
          ],
        });

        await kafkaProducer.send({
          topic: "customer-order-notification-topic",
          messages: [
            {
              value: JSON.stringify({
                notificationId: uuid(),
                orderId: createdOrderId,
                customerId: productPayload.customer,
                customerEmail: productPayload.customerEmail,
                productId,
                quantity: 0,
                totalAmount: 0,
                isPartialFulfillment: false,
                refundAmount: productPayload.amount,
                status: "rejected",
                timestamp: new Date().toISOString(),
                message: `Unfortunately, no sellers available for your order. Full refund of ₹${productPayload.amount.toFixed(
                  2
                )} will be processed.`,
              }),
            },
          ],
        });
      }

      await kafkaProducer.disconnect();
      await heartbeat();

      consumer.commitOffsets([{ topic, partition, offset: message.offset }]);
    } catch (error: Error | any) {
      console.error("Failed to process order message:", {
        error: error?.message,
        stack: error?.stack,
      });

      // Commit offset even on error to prevent infinite retry loop
      try {
        consumer.commitOffsets([{ topic, partition, offset: message.offset }]);
      } catch (commitError) {
        console.error("Failed to commit offset after error:", commitError);
      }
    }
  }

  consumer.run({
    partitionsConsumedConcurrently: 5,
    eachMessage: handleEachMessages,
    autoCommit: false,
  });
}

main().catch(console.error);

