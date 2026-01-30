import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { createClient as RedisClient } from 'redis'
import type { ProductType } from "../declaration/productType.d.ts";
import { uuidv4 } from "uuidv7";
import mysql from 'mysql2/promise';

const kafka: Kafka = new Kafka({
  clientId: "xvstore",
  brokers: ["localhost:9095", "localhost:9096", "localhost:9097"],
});

// MySQL Connection Pool
const mysqlPool = mysql.createPool({
  host: 'localhost',
  port: 3311,
  user: 'root',
  password: '',
  database: 'game_store',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function main() {
  const redisClient = RedisClient();
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

      // Check if product exists in MySQL (duplicates check)
      const [existingProducts] = await mysqlPool.execute(
        'SELECT id FROM products WHERE ean_number = ? LIMIT 1',
        [productPayload.eanUpcNumber]
      );

      const checkIfUPCExist = (existingProducts as any[])[0]?.id;

      // Insert or Update Product in MySQL
      const productId = productPayload._id || uuidv4();

      // We check if we need to insert the product
      // If it's a new product ID, we try to insert. 
      // Note: Sanity's createIfNotExists works on _id.

      const [productCheck] = await mysqlPool.execute(
        'SELECT id FROM products WHERE id = ?',
        [productId]
      );

      let isNewProduct = false;
      if ((productCheck as any[]).length === 0) {
        // Insert new product
        await mysqlPool.execute(`
          INSERT INTO products (
            id, product_name, category, ean_type, ean_number, model_number, 
            description, price, currency, discount, keywords, images, seller_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          productId,
          productPayload.productName,
          productPayload.category,
          productPayload.eanUpcIsbnGtinAsinType,
          productPayload.eanUpcNumber,
          productPayload.modelNumber,
          productPayload.productDescription,
          productPayload.price.pdtPrice,
          productPayload.price.currency,
          productPayload.price.discountPercentage,
          JSON.stringify(productPayload.keywords),
          JSON.stringify(productPayload.imagesBase64 || []),
          productPayload.seller
        ]);
        isNewProduct = true;
      }

      heartbeat();

      // Handle Seller Inventory (Quantity)
      // Check if inventory record exists
      const [inventoryCheck] = await mysqlPool.execute(
        'SELECT id, quantity FROM seller_inventory WHERE product_id = ? AND seller_id = ? AND pincode = ?',
        [productId, productPayload.seller, productPayload.pincode]
      );

      let sellerInventoryId;
      let newQuantity = productPayload.quantity;

      if ((inventoryCheck as any[]).length === 0) {
        // Create new inventory record
        sellerInventoryId = uuidv4();
        await mysqlPool.execute(`
            INSERT INTO seller_inventory (id, seller_id, product_id, pincode, quantity)
            VALUES (?, ?, ?, ?, ?)
         `, [sellerInventoryId, productPayload.seller, productId, productPayload.pincode, productPayload.quantity]);
      } else {
        // Update existing inventory
        const currentInventory = (inventoryCheck as any[])[0];
        sellerInventoryId = currentInventory.id;
        newQuantity = currentInventory.quantity + productPayload.quantity;

        await mysqlPool.execute(`
            UPDATE seller_inventory SET quantity = ? WHERE id = ?
         `, [newQuantity, sellerInventoryId]);
      }

      // Redis Updates
      if (redisClient.isOpen) {
        // We construct a result object similar to what might be expected by the UI/other services
        // conforming to ProductType somewhat, or the stored schema
        const productData = {
          _id: productId,
          productName: productPayload.productName,
          category: productPayload.category,
          // ... add other fields if needed for redis cache
          quantity: newQuantity,
          pincode: productPayload.pincode
        };

        // Note: The original code cached the 'result' from Sanity which contained the full product object.
        // We should likely cache the full payload logic + updated quantity.
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

      // Map potential duplicates
      if (checkIfUPCExist && checkIfUPCExist !== productId) {
        await mysqlPool.execute(`
           INSERT INTO potential_duplicates (existing_product_id, potential_duplicate_id)
           VALUES (?, ?)
        `, [checkIfUPCExist, productId]);
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

main();

