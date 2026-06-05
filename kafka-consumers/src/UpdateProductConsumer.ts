import { EachMessagePayload, Kafka } from "kafkajs";
import { createClient as RedisClient } from "redis";
import type { ProductType } from "../declaration/productType.d.ts";
import { uuidv7 as uuid } from 'uuidv7'
import mysql from 'mysql2/promise';
import { PRODUCT_SHARDS_CONFIG, GLOBAL_DB_CONFIG } from './utils/ShardRouter';
import { ShardHelper } from './utils/ShardHelper';

const shardPools = PRODUCT_SHARDS_CONFIG.map(config => mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
}));

const globalPool = mysql.createPool({
    ...GLOBAL_DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
});

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
            const productPayload: ProductType = message.value ? JSON.parse(
                message.value.toString()
            ) : null;

            if (!productPayload._id) return;

            const productId = productPayload._id;

            // DETERMINE SHARD by store pincode (deterministic, idempotent)
            // Matches seller_stores.shard_host computed at store creation time.
            // All products from the same store go to the same shard.
            const shardIndex = ShardHelper.getShardIndex(productPayload.pincode);
            const mysqlPool = shardPools[shardIndex];

            // 1. Update Products Table in Shard
            await mysqlPool.execute(
                'UPDATE products SET product_name = ?, category = ?, ean_upc_type = ?, ean_upc_number = ?, price_currency = ?, price_amount = ?, price_discount_percentage = ?, variations = ?, product_description = ?, model_number = ? WHERE id = ?',
                [
                    productPayload.productName,
                    productPayload.category,
                    productPayload.eanUpcIsbnGtinAsinType,
                    productPayload.eanUpcNumber,
                    productPayload.price?.currency || 'INR',
                    productPayload.price?.pdtPrice,
                    productPayload.price?.discountPercentage,
                    JSON.stringify(productPayload.variations || []),
                    productPayload.productDescription,
                    productPayload.modelNumber || null,
                    productId
                ]
            );

            // 1b. Update keywords: delete old, insert new
            await mysqlPool.execute('DELETE FROM product_keywords WHERE product_id = ?', [productId]);
            if (productPayload.keywords && Array.isArray(productPayload.keywords)) {
                for (const keyword of productPayload.keywords) {
                    await mysqlPool.execute(
                        'INSERT INTO product_keywords (product_id, keyword) VALUES (?, ?)',
                        [productId, keyword]
                    );
                }
            }

            // 1c. Update images: delete old, insert new
            await mysqlPool.execute('DELETE FROM product_images WHERE product_id = ?', [productId]);
            if (productPayload.imagesBase64 && Array.isArray(productPayload.imagesBase64)) {
                for (const image of productPayload.imagesBase64) {
                    await mysqlPool.execute(
                        'INSERT INTO product_images (product_id, size, `base64`, extension) VALUES (?, ?, ?, ?)',
                        [productId, image.size || null, image.base64 || null, image.extension || null]
                    );
                }
            }

            // 1d. Update product_quantities mapping
            if (productPayload.seller) {
                await mysqlPool.execute(
                    'INSERT INTO product_quantities (product_id, seller_id, pincode, quantity) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)',
                    [productId, productPayload.seller, productPayload.pincode, productPayload.quantity]
                );

                // Record seller → shard mapping in global DB for optimized multi-shard queries
                const shardHost = PRODUCT_SHARDS_CONFIG[shardIndex].host;
                try {
                    await globalPool.execute(
                        'INSERT IGNORE INTO seller_to_shards (seller_id, shard_host) VALUES (?, ?)',
                        [productPayload.seller, shardHost]
                    );
                } catch (e) {
                    console.warn(`Failed to record seller→shard mapping for ${productPayload.seller} on ${shardHost}:`, e);
                }
            }

            // 2. Update Seller Product Details (Inventory) in Shard
            const [inventoryCheck] = await mysqlPool.execute(
                'SELECT id, quantity FROM seller_product_details WHERE product_id = ? AND seller_id = ? AND pincode = ?',
                [productId, productPayload.seller, productPayload.pincode]
            );

            let totalQuantity = productPayload.quantity;

            if ((inventoryCheck as any[]).length === 0) {
                // If not exists, insert new record
                const detailId = uuid();
                await mysqlPool.execute(
                    'INSERT INTO seller_product_details (id, seller_id, product_id, pincode, quantity, geo_lat, geo_lng) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [
                        detailId,
                        productPayload.seller || '',
                        productId,
                        productPayload.pincode,
                        productPayload.quantity,
                        productPayload.geoPoint?.lat || null,
                        productPayload.geoPoint?.lng || null
                    ]
                );
            } else {
                // If exists, increment quantity
                const currentInventory = (inventoryCheck as any[])[0];
                const detailId = currentInventory.id;
                totalQuantity = currentInventory.quantity + productPayload.quantity;

                await mysqlPool.execute(
                    'UPDATE seller_product_details SET quantity = ?, geo_lat = ?, geo_lng = ? WHERE id = ?',
                    [
                        totalQuantity,
                        productPayload.geoPoint?.lat || null,
                        productPayload.geoPoint?.lng || null,
                        detailId
                    ]
                );
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