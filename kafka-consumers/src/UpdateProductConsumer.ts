import { EachMessagePayload, Kafka } from "kafkajs";
import { createClient as RedisClient } from "redis";
import type { ProductType } from "../declaration/productType.d.ts";
import { uuidv7 as uuid } from 'uuidv7'
import mysql from 'mysql2/promise';
import { ShardRouter, PRODUCT_SHARDS_CONFIG } from './utils/ShardRouter';

const shardPools = PRODUCT_SHARDS_CONFIG.map(config => mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
}));

const kafka: Kafka = new Kafka({
    clientId: "xvstore",
    brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
});

async function main() {
    const redisClient = RedisClient({
        url: "redis://redis_storage:6379"
    });
    await redisClient.connect();

    const consumer = kafka.consumer({
        groupId: "product-db-update",
    });

    await consumer.connect();
    await consumer.subscribe({ topic: "update-product-topic" });

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

            if (!productPayload._id) return;

            const productId = productPayload._id;

            // DETERMINE SHARD
            const shardIndex = ShardRouter.getShardIndex(productId);
            const mysqlPool = shardPools[shardIndex];

            // 1. Update Products Table in Shard
            await mysqlPool.execute(`
                UPDATE products SET
                    product_name = ?,
                    category = ?,
                    ean_upc_type = ?,
                    ean_upc_number = ?,
                    price_amount = ?,
                    price_discount_percentage = ?,
                    variations = ?,
                    product_description = ?,
                    model_number = ?,
                    imagesBase64 = ?
                WHERE id = ?
            `, [
                productPayload.productName,
                productPayload.category,
                productPayload.eanUpcIsbnGtinAsinType,
                productPayload.eanUpcNumber,
                productPayload.price.pdtPrice,
                productPayload.price.discountPercentage,
                JSON.stringify(productPayload.variations || []),
                productPayload.productDescription,
                productPayload.modelNumber || null,
                JSON.stringify(productPayload.imagesBase64 || []),
                productId
            ]);

            // 2. Update Seller Product Details (Inventory) in Shard
            const [inventoryCheck] = await mysqlPool.execute(
                'SELECT id, quantity FROM seller_product_details WHERE product_id = ? AND seller_id = ? AND pincode = ?',
                [productId, productPayload.seller, productPayload.pincode]
            );

            let totalQuantity = productPayload.quantity;

            if ((inventoryCheck as any[]).length === 0) {
                // If not exists, insert new record
                const detailId = uuid();
                await mysqlPool.execute(`
                    INSERT INTO seller_product_details (id, seller_id, product_id, pincode, quantity, geo_lat, geo_lng)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [
                    detailId,
                    productPayload.seller || '',
                    productId,
                    productPayload.pincode,
                    productPayload.quantity,
                    productPayload.geoPoint?.lat || null,
                    productPayload.geoPoint?.lng || null
                ]);
            } else {
                // If exists, increment quantity
                const currentInventory = (inventoryCheck as any[])[0];
                const detailId = currentInventory.id;
                totalQuantity = currentInventory.quantity + productPayload.quantity;

                await mysqlPool.execute(`
                    UPDATE seller_product_details SET quantity = ?, geo_lat = ?, geo_lng = ? WHERE id = ?
                `, [
                    totalQuantity,
                    productPayload.geoPoint?.lat || null,
                    productPayload.geoPoint?.lng || null,
                    detailId
                ]);
            }

            // 3. Update Redis
            if (redisClient.isOpen) {
                const fullResult = {
                    ...productPayload,
                    _id: productId,
                    quantity: totalQuantity
                };

                await redisClient.hSet("products:details", productId, JSON.stringify(fullResult));
                await redisClient.hSet(`products:${productPayload.category}:${productPayload.pincode}`, productId, JSON.stringify(fullResult));
                await redisClient.hSet(`products:all:${productPayload.pincode}`, productId, JSON.stringify(fullResult));
                console.log(`<< Redis updated for product ${productId} >>`);
            }

            await heartbeat();
            consumer.commitOffsets([
                { topic, partition, offset: message.offset },
            ]);
        } catch (error: Error | any) {
            console.error("Error in UpdateProductConsumer:", error.message);
        }
    }

    consumer.run({
        partitionsConsumedConcurrently: 5,
        eachMessage: handleEachMessages,
        autoCommit: false,
    });
}

main().catch(console.error);
