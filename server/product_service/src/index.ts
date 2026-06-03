import { Worker } from "worker_threads";
import cluster from "cluster";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { availableParallelism } from "os";
import type { ProductType } from "@declaration/index.d.ts";
import { createClient as RedisClient, RedisClientType } from "redis";
import { spawn } from "child_process";
import { Kafka, RecordMetadata } from "kafkajs";
import { JwtPayload } from "@clerk/types";
import { verifyToken } from "@clerk/backend";
import mysql from 'mysql2/promise';
import { ShardRouter, PRODUCT_SHARDS_CONFIG, GLOBAL_DB_CONFIG } from './utils/ShardRouter.ts';

dotenv.config();

// MySQL Connection Pools for Shards
const shardPools = PRODUCT_SHARDS_CONFIG.map((config: any) => mysql.createPool({
  ...config,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}));

// Global DB Pool
const globalPool = mysql.createPool({
  ...GLOBAL_DB_CONFIG,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

declare global {
  namespace Express {
    interface Request {
      auth: NonNullable<JwtPayload | undefined>;
      adminId: string;
    }
  }
}


if (cluster.isPrimary) {

  let old_child_process: any[] = []
  setInterval(() => {
    const child_process = spawn('ping', [
      `http://product_service:${process.env.PORT}/`,
    ])

    while (old_child_process.length > 0) {
      let pop_process = old_child_process.pop()
      pop_process?.kill(0)
    }

    child_process.stdout.on('data', buffer => {
      console.log(buffer.toString('utf-8'))
      old_child_process.push(child_process)
    })
  }, 60000)

  let p;
  for (let i = 0; i < availableParallelism(); i++) {
    p = cluster.fork();
    p.on("exit", (_statusCode: number) => {
      p = cluster.fork();
    });
  }
} else {
  const redisClient: RedisClientType = RedisClient({
    url: 'redis://redis_storage:6379'
  });

  //#region clerk_middleware
  const verifyClerkToken = async (req: Request<{}, {}, ProductType>, res: Response, next: NextFunction) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        res.status(401).json({ error: 'No token provided' });
        return;
      }
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
        clockSkewInMs: 60000
      });
      req.auth = payload;
      next();
    } catch (error) {
      console.error('Token verification failed:', error);
      res.status(403).json({ error: 'Invalid token' });
      return;
    }
  };
  //#endregion

  async function authMiddleware(req: Request<{}, {}, any>, res: Response, next: NextFunction) {
    const token = req.headers['x-admin-id'];
    if (!token) {
      res.status(401).send('Missing token!');
      return;
    }
    let result;
    result = (await redisClient.sIsMember(`set:admin:id`, token as unknown as string));
    if (result) {
      next();
      return;
    }

    // Check in MySQL global DB instead of Sanity
    const [adminRows] = await globalPool.execute(
      'SELECT id FROM sellers WHERE id = ?',
      [token]
    );

    if (Array.isArray(adminRows) && adminRows.length > 0) {
      await redisClient.sAdd(`set:admin:id`, token as string);
      next();
      return;
    }
    else
      res.status(403).send('Unauthorized token!');
  }

  async function main() {
    const app: Express = express();
    const kafka: Kafka = new Kafka({
      clientId: 'xv-store',
      brokers: ['kafka1:9092', 'kafka2:9093', 'kafka3:9094']
    });
    await redisClient.connect();
    app.use(cors());
    app.use(express.json({ limit: "25mb" }));
    app.use(express.urlencoded({ extended: true, limit: "25mb" }));

    app.get("/fetch-products/:pincode/:category/:page",
      async (req: Request<{ category: string; page: number, pincode: number }>, res: Response) => {
        res.setHeader('Content-Type', 'application/json');
        const { pincode, category, page } = req.params;
        const offset = (page - 1) * 10;

        if (redisClient.isOpen) {
          const cacheKey = `products:${category}:${pincode}`;
          const cachedData = await redisClient.hVals(cacheKey);
          if (cachedData.length > 0) {
            const paginated = cachedData.slice(offset, offset + 10).map(item => JSON.parse(item));
            if (paginated.length > 0) {
              res.json(paginated);
              return;
            }
          }
        }

        // Aggregate from all shards
        try {
          const shardQueries = shardPools.map(pool => {
            let sql = `
              SELECT p.*, spd.quantity 
              FROM products p
              JOIN seller_product_details spd ON p.id = spd.product_id
              WHERE spd.pincode = ?
            `;
            const params: any[] = [pincode];
            if (category !== 'all') {
              sql += ' AND p.category = ?';
              params.push(category);
            }
            return pool.execute(sql, params);
          });

          const results = await Promise.all(shardQueries);
          let allProducts: any[] = [];
          results.forEach(([rows]) => {
            if (Array.isArray(rows)) {
              allProducts = allProducts.concat(rows);
            }
          });

          // Sort and Paginate (Simplistic for now, should ideally be more sophisticated)
          const productIds = [...new Set(allProducts.map((p: any) => p.id))];
          
          // Fetch images for all products from all shards
          const imagesPromises = shardPools.map(pool => {
            if (productIds.length === 0) return Promise.resolve([[], []]);
            const placeholders = productIds.map(() => '?').join(',');
            return pool.execute(
              `SELECT product_id, size, \`base64\`, extension FROM product_images WHERE product_id IN (${placeholders})`,
              productIds
            );
          });
          const imagesResults = await Promise.all(imagesPromises);
          
          // Build image map
          const imageMap: Record<string, any[]> = {};
          imagesResults.forEach(([rows]: any) => {
            if (Array.isArray(rows)) {
              rows.forEach((row: any) => {
                if (!imageMap[row.product_id]) imageMap[row.product_id] = [];
                imageMap[row.product_id].push({ size: row.size, base64: row.base64, extension: row.extension });
              });
            }
          });

          // Fetch keywords for all products from all shards
          const keywordsPromises = shardPools.map(pool => {
            if (productIds.length === 0) return Promise.resolve([[], []]);
            const placeholders = productIds.map(() => '?').join(',');
            return pool.execute(
              `SELECT product_id, keyword FROM product_keywords WHERE product_id IN (${placeholders})`,
              productIds
            );
          });
          const keywordsResults = await Promise.all(keywordsPromises);
          
          // Build keywords map
          const keywordsMap: Record<string, string[]> = {};
          keywordsResults.forEach(([rows]: any) => {
            if (Array.isArray(rows)) {
              rows.forEach((row: any) => {
                if (!keywordsMap[row.product_id]) keywordsMap[row.product_id] = [];
                keywordsMap[row.product_id].push(row.keyword);
              });
            }
          });
          
          const paginatedProducts = allProducts.slice(offset, offset + 10).map((p: any) => ({
            _id: p.id,
            productName: p.product_name,
            category: p.category,
            price: {
              pdtPrice: p.price_amount,
              discountPercentage: p.price_discount_percentage,
              currency: p.price_currency || 'INR'
            },
            quantity: p.quantity,
            imagesBase64: imageMap[p.id] || [],
            keywords: keywordsMap[p.id] || [],
            eanUpcNumber: p.ean_upc_number,
            eanUpcIsbnGtinAsinType: p.ean_upc_type,
            productDescription: p.product_description,
            modelNumber: p.model_number
          }));

          // Cache results
          if (redisClient.isOpen) {
            const cacheKey = `products:${category}:${pincode}`;
            for (const p of paginatedProducts) {
              await redisClient.hSet(cacheKey, p._id, JSON.stringify(p));
            }
          }

          res.json(paginatedProducts);
        } catch (err) {
          console.error("Error fetching products from shards:", err);
          res.status(500).json({ error: "Failed to fetch products" });
        }
      });

    //fetch particular product info for user display
    app.get(
      "/fetch-product-detail/:pincode/:productId",
      async (
        req: Request<{ productId: string; pincode: string }>,
        res: Response
      ) => {
        res.setHeader("Content-Type", "application/json");
        const pincode = req.params.pincode;
        const productId: string | undefined = req.params.productId
        if (productId) {
          try {
            if (redisClient.isOpen) {
              const fromRedisResult = await redisClient.hGet('products:details', productId)
              if (fromRedisResult) {
                res.status(200).json(JSON.parse(fromRedisResult));
                return;
              }
            }

            // MySQL Shard Fetch
            const shardIndex = ShardRouter.getShardIndex(productId);
            const mysqlPool = shardPools[shardIndex];

            const [productRows] = await mysqlPool.execute(
              'SELECT * FROM products WHERE id = ?',
              [productId]
            );

            if (Array.isArray(productRows) && productRows.length > 0) {
              const product = productRows[0] as any;

              // Fetch regional quantity from the same shard
              const [quantityRows] = await mysqlPool.execute(
                'SELECT quantity FROM seller_product_details WHERE product_id = ? AND pincode = ?',
                [productId, pincode]
              );

              const quantity = (quantityRows as any[])[0]?.quantity || 0;

              // Fetch images from product_images table
              const [imageRows] = await mysqlPool.execute(
                'SELECT size, `base64`, extension FROM product_images WHERE product_id = ?',
                [productId]
              );
              
              const imagesBase64 = Array.isArray(imageRows) 
                ? (imageRows as any[]).map((img: any) => ({
                    size: img.size,
                    base64: img.base64,
                    extension: img.extension
                  }))
                : [];

              // Fetch keywords from product_keywords table
              const [keywordRows] = await mysqlPool.execute(
                'SELECT keyword FROM product_keywords WHERE product_id = ?',
                [productId]
              );
              const keywords = Array.isArray(keywordRows)
                ? (keywordRows as any[]).map((k: any) => k.keyword)
                : [];

              const result = {
                _id: product.id,
                productName: product.product_name,
                category: product.category,
                eanUpcNumber: product.ean_upc_number,
                eanUpcIsbnGtinAsinType: product.ean_upc_type,
                price: {
                  pdtPrice: product.price_amount,
                  discountPercentage: product.price_discount_percentage,
                  currency: product.price_currency || 'INR'
                },
                quantity: quantity,
                keywords,
                productDescription: product.product_description,
                modelNumber: product.model_number,
                imagesBase64
              };

              res.status(200).json(result);

              // Cache to Redis
              if (redisClient.isOpen) {
                await redisClient.hSet('products:details', productId, JSON.stringify(result));
              }
              return;
            }

            res.status(404).json({ error: "Product not found" });
            return;
          } catch (err) {
            console.error("Fetch detail error:", err);
            res.status(502).json({ error: "Service error!" });
            return;
          }
        }
      }
    );

    //just fetch the quantity of the product in that location
    app.get(
      "/fetch-product-quantity/:pincode/:productId",
      async (req: Request<{ productId: string; pincode: string }>, res: Response, next: NextFunction) => {
        const { productId, pincode } = req.params;
        if (productId) {
          try {
            if (redisClient.isOpen) {
              const fromRedisResult = await redisClient.hGet('products:details', productId);
              if (fromRedisResult) {
                const product = JSON.parse(fromRedisResult);
                // In our new schema, quantity might be directly in the cached object or need a separate lookup
                if (product.quantity !== undefined) {
                  res.status(200).json({ quantity: product.quantity });
                  return;
                }
              }
            }

            // Fetch from MySQL shard
            const shardIndex = ShardRouter.getShardIndex(productId);
            const mysqlPool = shardPools[shardIndex];

            const [rows]: any = await mysqlPool.execute(
              'SELECT quantity FROM seller_product_details WHERE product_id = ? AND pincode = ?',
              [productId, pincode]
            );

            if (Array.isArray(rows) && rows.length > 0) {
              res.status(200).json({ quantity: rows[0].quantity });
            } else {
              res.status(200).json({ quantity: 0 });
            }
          }
          catch (err) {
            console.error("Fetch quantity error:", err);
            res.status(502).json({ error: "Service error!" });
          }
        }
      });
//post to kafka topic [product-topic] to create the product
    app.post(
      "/add-product",
      verifyClerkToken,
      authMiddleware,
      async (req: Request<{}, {}, ProductType>, res: Response) => {
        const producer = kafka.producer();
        try {
          console.log(req.body)
          await producer.connect();
          const recordMetaData: RecordMetadata[] = await producer.send({
            topic: "add-product-topic",
            messages: [{ value: JSON.stringify(req.body) }],
          });
          res.status(201).json({ message: "Product added successfully", metadata: recordMetaData });
        } catch (err) {
          console.error("Error adding product:", err);
          res.status(500).json({ error: "Failed to add product" });
          return;
        } finally {
          await producer.disconnect();
        }
      }
    );

    //patch to update same product
    app.patch("/update-product",
      verifyClerkToken,
      authMiddleware,
      async (req: Request<{}, {}, ProductType>, res: Response) => {
        const producer = kafka.producer();
        try {
          await producer.connect();
          const recordMetaData: RecordMetadata[] = await producer.send({
            topic: 'update-product-topic',
            messages: [{ value: JSON.stringify(req.body) }]
          });
          res.status(200).json({ message: "Product update queued" });
        } catch (err) {
          console.error("Error updating product:", err);
          res.status(500).json({ error: "Failed to update product" });
          return;
        } finally {
          await producer.disconnect();
        }
      });

    app.listen(process.env.PORT ?? 5002, () =>
      console.log("listening on PORT:" + process.env.PORT)
    );
  }
  main();
}
