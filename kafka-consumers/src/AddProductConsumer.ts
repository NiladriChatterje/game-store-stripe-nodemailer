import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { createClient as RedisClient } from 'redis'
import type { ProductType } from "../declaration/productType.d.ts";
import { uuidv4 } from "uuidv7";
import mysql from 'mysql2/promise';
import { ShardRouter, PRODUCT_SHARDS_CONFIG, GLOBAL_DB_CONFIG } from './utils/ShardRouter';

const kafka: Kafka = new Kafka({
  clientId: "xvstore",
  brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});

// MySQL Connection Pools for Shards
const shardPools = PRODUCT_SHARDS_CONFIG.map(config => mysql.createPool({
  ...config,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}));

// Global DB Pool (though not heavily used in this consumer yet)
const globalPool = mysql.createPool({
  ...GLOBAL_DB_CONFIG,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

async function main() {
  const redisClient = RedisClient({
    socket: {
      host: 'redis_storage',
      port: 6379
    }
  });
  await redisClient.connect();

  const consumer = kafka.consumer({
    groupId: "product-db-save",
  });

  await consumer.connect();
  await consumer.subscribe({ topic: "add-product-topic" });

  async function handleEachMessages({
    heartbeat,
    message,
    partition,
    topic,
  }: EachMessagePayload) {
    console.log("<arrayBufferLike> : ", message.value);

    try {
      const productPayload: ProductType = JSON.parse(
        message.value.toString()
      );

      const productId = productPayload._id || uuidv4();

      // DETERMINE SHARD
      const shardIndex = ShardRouter.getShardIndex(productId);
      const mysqlPool = shardPools[shardIndex];

      console.log(`Routing product ${productId} to shard ${shardIndex}`);

      // Check if product exists in this shard
      const [existingProducts] = await mysqlPool.execute(
        'SELECT id FROM products WHERE ean_upc_number = ? LIMIT 1',
        [productPayload.eanUpcNumber]
      );

      const checkIfUPCExist = (existingProducts as any[])[0]?.id;

      // Check if we need to insert the product
      const [productCheck] = await mysqlPool.execute(
        'SELECT id FROM products WHERE id = ?',
        [productId]
      );

      let isNewProduct = false;
      if ((productCheck as any[]).length === 0) {
        // Insert new product into selected shard
        await mysqlPool.execute(`
          INSERT INTO products (
            id, product_name, category, ean_upc_type, ean_upc_number, 
            price_amount, price_discount_percentage, variations, 
            product_description, model_number, imagesBase64
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          productId,
          productPayload.productName,
          productPayload.category,
          productPayload.eanUpcIsbnGtinAsinType,
          productPayload.eanUpcNumber,
          productPayload.price.pdtPrice,
          productPayload.price.discountPercentage,
          JSON.stringify(productPayload.variations || []),
          productPayload.productDescription,
          productPayload.modelNumber || null,
          JSON.stringify(productPayload.imagesBase64 || [])
        ]);
        isNewProduct = true;
      }

      heartbeat();

      // Handle Seller Product Details (Sharded alongside product)
      const [inventoryCheck] = await mysqlPool.execute(
        'SELECT id, quantity FROM seller_product_details WHERE product_id = ? AND seller_id = ? AND pincode = ?',
        [productId, productPayload.seller, productPayload.pincode]
      );

      let newQuantity = productPayload.quantity;

      if ((inventoryCheck as any[]).length === 0) {
        // Create new record in shard
        const detailId = uuidv4();
        await mysqlPool.execute(`
            INSERT INTO seller_product_details (id, seller_id, product_id, pincode, quantity, geo_lat, geo_lng)
            VALUES (?, ?, ?, ?, ?, ?, ?)
         `, [
          detailId,
          productPayload.seller,
          productId,
          productPayload.pincode,
          productPayload.quantity,
          productPayload.geoPoint?.lat || null,
          productPayload.geoPoint?.lng || null
        ]);
      } else {
        // Update existing record in shard
        const currentInventory = (inventoryCheck as any[])[0];
        const detailId = currentInventory.id;
        newQuantity = currentInventory.quantity + productPayload.quantity;

        await mysqlPool.execute(`
            UPDATE seller_product_details SET quantity = ?, geo_lat = ?, geo_lng = ? WHERE id = ?
         `, [
          newQuantity,
          productPayload.geoPoint?.lat || null,
          productPayload.geoPoint?.lng || null,
          detailId
        ]);
      }

      // Redis Updates (Cache remains centralized or based on your cluster config)
      if (redisClient.isOpen) {
        const fullResult = {
          ...productPayload,
          _id: productId,
          quantity: newQuantity
        };

        await redisClient.hSet("products:details", productId, JSON.stringify(fullResult))
        await redisClient.hSet(`products:${productPayload.category}:${productPayload.pincode}`, productId, JSON.stringify(fullResult));
        await redisClient.hSet(`products:all:${productPayload.pincode}`, productId,
          JSON.stringify(fullResult))
        console.log("Redis updated")
      }

      // Map potential duplicates within the same shard (or globally - this is tricky with sharding)
      // For now, we handle it within the shard.
      if (checkIfUPCExist && checkIfUPCExist !== productId) {
        // potential_duplicates table should also exist on shards if we check per-shard
        // but if we want global duplicate check, it should be in global_sql_data.
        // Let's stick to shard-local for now or move to global later.
        try {
          await mysqlPool.execute(`
                INSERT INTO potential_duplicates (id, existing_product_id, potential_duplicate_id)
                VALUES (?, ?, ?)
            `, [uuidv4(), checkIfUPCExist, productId]);
        } catch (e) {
          console.log("Duplicate mapping failed (maybe already exists)");
        }
      }

      consumer.commitOffsets([
        { topic, partition, offset: message.offset },
      ]);
    } catch (error: Error | any) {
      console.log("error :", error.message)
    }
  }

  consumer.run({
    partitionsConsumedConcurrently: 5,
    eachMessage: handleEachMessages,
    autoCommit: false,
  });
}

main().catch(console.error);


