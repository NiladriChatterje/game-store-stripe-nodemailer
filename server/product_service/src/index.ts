import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import type { ProductType } from "@declaration/index.d.ts";
import { createClient as RedisClient, RedisClientType } from "redis";
import { Kafka, RecordMetadata } from "kafkajs";
import { JwtPayload } from "@clerk/types";
import { verifyToken } from "@clerk/backend";
import mysql from 'mysql2/promise';
import { PRODUCT_SHARDS_CONFIG, GLOBAL_DB_CONFIG } from './utils/ShardRouter.ts';
import { ShardHelper } from './utils/ShardHelper.ts';

dotenv.config();

// MySQL Connection Pools for Shards
const shardPools = PRODUCT_SHARDS_CONFIG.map((config: any) => mysql.createPool({
  ...config,
  waitForConnections: true,
  connectionLimit: 2,
  queueLimit: 10
}));

// Global DB Pool
const globalPool = mysql.createPool({
  ...GLOBAL_DB_CONFIG,
  waitForConnections: true,
  connectionLimit: 2,
  queueLimit: 10
});

declare global {
  namespace Express {
    interface Request {
      auth: NonNullable<JwtPayload | undefined>;
      adminId: string;
    }
  }
}

async function main() {
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

        const productIds = [...new Set(allProducts.map((p: any) => p.id))];

        const imagesPromises = shardPools.map(pool => {
          if (productIds.length === 0) return Promise.resolve([[], []]);
          const placeholders = productIds.map(() => '?').join(',');
          return pool.execute(
            `SELECT product_id, size, \`base64\`, extension FROM product_images WHERE product_id IN (${placeholders})`,
            productIds
          );
        });
        const imagesResults = await Promise.all(imagesPromises);

        const imageMap: Record<string, any[]> = {};
        imagesResults.forEach(([rows]: any) => {
          if (Array.isArray(rows)) {
            rows.forEach((row: any) => {
              if (!imageMap[row.product_id]) imageMap[row.product_id] = [];
              imageMap[row.product_id].push({ size: row.size, base64: row.base64, extension: row.extension });
            });
          }
        });

        const keywordsPromises = shardPools.map(pool => {
          if (productIds.length === 0) return Promise.resolve([[], []]);
          const placeholders = productIds.map(() => '?').join(',');
          return pool.execute(
            `SELECT product_id, keyword FROM product_keywords WHERE product_id IN (${placeholders})`,
            productIds
          );
        });
        const keywordsResults = await Promise.all(keywordsPromises);

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

  app.get(
    "/fetch-product-detail/:pincode/:productId",
    async (req: Request<{ productId: string; pincode: string }>, res: Response) => {
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

          const shardIndex = ShardHelper.getShardIndex(pincode);
          const mysqlPool = shardPools[shardIndex];

          const [productRows] = await mysqlPool.execute(
            'SELECT * FROM products WHERE id = ?',
            [productId]
          );

          if (Array.isArray(productRows) && productRows.length > 0) {
            const product = productRows[0] as any;

            const [quantityRows] = await mysqlPool.execute(
              'SELECT quantity FROM seller_product_details WHERE product_id = ? AND pincode = ?',
              [productId, pincode]
            );

            const quantity = (quantityRows as any[])[0]?.quantity || 0;

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

  app.get(
    "/fetch-product/:productId",
    async (req: Request<{ productId: string }>, res: Response) => {
      res.setHeader("Content-Type", "application/json");
      const { productId } = req.params;

      if (!productId) {
        res.status(400).json({ error: "Missing productId" });
        return;
      }

      try {
        // Check Redis cache first
        if (redisClient.isOpen) {
          const fromRedisResult = await redisClient.hGet('products:details', productId);
          if (fromRedisResult) {
            res.status(200).json([JSON.parse(fromRedisResult)]);
            return;
          }
        }

        // Search across ALL shards since we don't have a pincode
        const shardQueries = shardPools.map(async (pool, idx) => {
          try {
            const [productRows] = await pool.execute(
              'SELECT * FROM products WHERE id = ?',
              [productId]
            );
            return { shardIndex: idx, rows: productRows as any[] };
          } catch (err) {
            return { shardIndex: idx, rows: [] };
          }
        });

        const shardResults = await Promise.all(shardQueries);

        // Find the shard that has the product
        let foundProduct: any = null;
        let foundShardIndex = -1;

        for (const result of shardResults) {
          if (Array.isArray(result.rows) && result.rows.length > 0) {
            foundProduct = result.rows[0];
            foundShardIndex = result.shardIndex;
            break;
          }
        }

        if (!foundProduct) {
          res.status(404).json({ error: "Product not found" });
          return;
        }

        const mysqlPool = shardPools[foundShardIndex];

        // Fetch quantity from seller_product_details
        const [quantityRows] = await mysqlPool.execute(
          'SELECT quantity, pincode FROM seller_product_details WHERE product_id = ? LIMIT 1',
          [productId]
        );

        const quantity = (quantityRows as any[])[0]?.quantity || 0;
        const pincode = (quantityRows as any[])[0]?.pincode || '';

        // Fetch images
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

        // Fetch keywords
        const [keywordRows] = await mysqlPool.execute(
          'SELECT keyword FROM product_keywords WHERE product_id = ?',
          [productId]
        );
        const keywords = Array.isArray(keywordRows)
          ? (keywordRows as any[]).map((k: any) => k.keyword)
          : [];

        const result = {
          _id: foundProduct.id,
          productName: foundProduct.product_name,
          category: foundProduct.category,
          eanUpcNumber: foundProduct.ean_upc_number,
          eanUpcIsbnGtinAsinType: foundProduct.ean_upc_type,
          price: {
            pdtPrice: foundProduct.price_amount,
            discountPercentage: foundProduct.price_discount_percentage,
            currency: foundProduct.price_currency || 'INR'
          },
          quantity,
          pincode,
          keywords,
          productDescription: foundProduct.product_description,
          modelNumber: foundProduct.model_number,
          imagesBase64
        };

        // Cache to Redis for future lookups
        if (redisClient.isOpen) {
          await redisClient.hSet('products:details', productId, JSON.stringify(result)).catch(() => {});
        }

        // Return as array to match frontend expectations
        res.status(200).json([result]);
      } catch (err) {
        console.error("Fetch product error:", err);
        res.status(502).json({ error: "Service error!" });
      }
    }
  );

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
              if (product.quantity !== undefined) {
                res.status(200).json({ quantity: product.quantity });
                return;
              }
            }
          }

          const shardIndex = ShardHelper.getShardIndex(pincode);
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