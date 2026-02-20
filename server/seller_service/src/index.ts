import { Worker } from "worker_threads";
import cluster from "cluster";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { availableParallelism } from "os";
import { AdminFieldsType } from "./delcarations/AdminFieldType";
import { createClient, SanityClient } from '@sanity/client'
import { createClient as RedisClient } from "redis";
import { sanityConfig } from './utils/index.js';
import { Kafka, logLevel, Producer, RecordMetadata } from "kafkajs";
import { createTransport } from "nodemailer";
import { ClerkClient, verifyToken } from "@clerk/backend";
import { spawn } from 'node:child_process'
import { JwtPayload } from "@clerk/types";
import mysql from 'mysql2/promise';
import { ShardHelper } from './utils/ShardHelper.js';


dotenv.config();

//#region custom express.Request definition
declare module "express-serve-static-core" {
  interface Request {
    auth: NonNullable<JwtPayload | undefined>;
    userId: string;
  }
}
//#endregion

if (cluster.isPrimary) {
  let old_child_process: any[] = []
  setInterval(() => {
    const child_process = spawn('ping', [
      `http://localhost:${process.env.PORT}/`,
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
  const mailOption = {
    service: 'gmail',
    auth: {
      user: process.env.AUTH_EMAIL,
      pass: process.env.APP_KEY,
    },
  }
  const mailTransport = createTransport(mailOption);
  const kafka = new Kafka({
    clientId: "xv store",
    brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
    retry: {
      retries: 2,
    },
    logLevel: logLevel.ERROR,
    logCreator: (logEntry) => {
      return ({ namespace, level, label, log }) => {
        const { message, ...extra } = log;

      };
    },
  });
  const app: Express = express();
  const sanityClient: SanityClient = createClient(sanityConfig);
  const redisClient = RedisClient({
    url: 'redis://redis_storage:6379'
  });
  try {
    await redisClient.connect();
  } catch (e: Error | any) {
    console.log("<error connecting redis server>");
    console.log(e.message)
  }

  app.use(cors());
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });


  //#region clerk_middleware
  const verifyClerkToken = async (req: Request<{}, {}, AdminFieldsType>, res: Response, next: NextFunction) => {
    try {
      // Get token from Authorization header
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        res.status(401).json({ error: 'No token provided' });
        return;
      }
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
        clockSkewInMs: 300000 // Increased to 5 minutes to handle clock skew issues
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


  //#region Helper function to check subscription validity
  function checkSubscriptionValidity(adminData: AdminFieldsType | null): boolean {
    if (!adminData || !adminData.subscriptionPlan || adminData.subscriptionPlan.length === 0) {
      return false;
    }

    // Check if any subscription plan has a valid future expiration date
    const currentTime = new Date().getTime();
    console.log("inside checkSubscriptionValidity function ::: ", adminData.subscriptionPlan);
    for (const plan of adminData.subscriptionPlan) {
      // Use the correct field name from Sanity schema: planSchemaList
      if (plan?.planSchemaList?.expireDate) {
        const expireTime = new Date(plan.planSchemaList.expireDate).getTime();
        console.log("Checking plan with expire date:", plan.planSchemaList.expireDate);
        if (expireTime > currentTime) {
          return true; // Found at least one valid plan
        }
      }
    }

    return false; // No valid plans found
  }
  //#endregion

  //#region ENDPOINTS
  //ping self to keep server awake
  app.get("/", (req: Request, res: Response) => {
    res.end("pinged!");
  });

  //admin creation [kafka interaction]
  app.post(
    "/create-admin",
    verifyClerkToken,
    async (req: Request<{}, {}, AdminFieldsType>, res: Response) => {
      const value = req.body;

      console.log("<admin-data-received> : ", value);
      let producer: Producer;
      try {
        producer = kafka.producer({
          allowAutoTopicCreation: true,
          transactionTimeout: 60000,
        });

        console.log("Connecting Kafka producer...");
        await producer.connect();
        console.log("Kafka producer connected.");

        console.log(`Sending message to topic: admin-create-topic`);
        const recordMetaData: RecordMetadata[] = await producer.send({
          topic: "admin-create-topic",
          messages: [{ value: JSON.stringify(value) }],
        });
        console.log("Message sent successfully. Metadata:", recordMetaData);

        res.status(201).send('Account will be created soon!')
        await producer.disconnect();
        console.log("Kafka producer disconnected.");
      }
      catch (err: any) {
        console.error("Error in admin creation endpoint: ", err);
        res.status(500).json({ error: "Internal server error!", details: err.message });
      }
    }
  );


  //get admin credential [redis + sanity interaction]
  app.get(
    "/fetch-admin-data/:_id",
    verifyClerkToken,
    async (req: Request<{ _id: string }>, res: Response) => {
      console.log(req.params._id);
      try {
        if (redisClient.isOpen) {
          const result = await redisClient.hGet("hashSet:admin:details", req.params._id);
          const subscriptionPlan = await redisClient.hGet("admin:subscription:details", req.params._id);
          if (result) {
            console.log("<Redis admin hit>")
            const adminData = JSON.parse(result);
            let isPlanActive = false;

            if (subscriptionPlan) {
              const planData = JSON.parse(subscriptionPlan);
              const planExpireDate = planData.planExpireDate;
              const currentTime = new Date().getTime();
              const expireTime = new Date(planExpireDate).getTime();
              if (expireTime > currentTime) {
                isPlanActive = true;

                // Inject the subscription plan details into the response 
                // because the hashSet might have been cached prior to subscription.
                if (!adminData.subscriptionPlan || adminData.subscriptionPlan.length === 0) {
                  adminData.subscriptionPlan = [{
                    transactionId: planData.transactionId,
                    amount: planData.amount,
                    storeAllotment: planData.storeAllotment ?? 1,
                    planSchemaList: {
                      activeDate: planData.planActiveDate,
                      expireDate: planData.planExpireDate
                    }
                  }];
                }
              } else {
                await redisClient.hDel("admin:subscription:details", req.params._id);
              }
            }

            res.json({ ...adminData, isPlanActive });
            return;
          }
        }
        // MySQL Replacement
        const connection = await mysql.createConnection({
          host: 'global_sql_data',
          port: 3306,
          user: 'root',
          database: 'xvstore'
        });
        console.log("<<Connection successfull>>");
        const [rows] = await connection.execute('SELECT * FROM sellers WHERE id = ?', [req.params._id]);
        console.log("<MySQL admin data from sql> : ", rows);
        let result: any = null;
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0] as any;
          result = {
            _id: row.id,
            _type: 'admin',
            username: row.username,
            email: row.email,
            phone: row.phone,
            geoPoint: {
              lat: row.geo_lat,
              lng: row.geo_lng
            },
            address: {
              pincode: row.address_pincode,
              county: row.address_county,
              state: row.address_state,
              country: row.address_country
            },
            subscriptionPlan: []
          };

          // Fetch subscriptions
          const [subRows] = await connection.execute('SELECT * FROM seller_subscriptions WHERE seller_id = ?', [req.params._id]);

          if (Array.isArray(subRows) && subRows.length > 0) {
            result.subscriptionPlan = subRows.map((sub: any) => ({
              _key: sub.id,
              transactionId: sub.transaction_id,
              amount: sub.amount,
              storeAllotment: sub.store_allotment ?? 1,
              planSchemaList: {
                activeDate: sub.plan_active_date,
                expireDate: sub.plan_expire_date
              }
            }));
          }

          // Fetch configured stores for this seller
          const [storeRows] = await connection.execute(
            'SELECT id, county, pincode, state, country FROM store WHERE seller_id = ?',
            [req.params._id]
          );
          if (Array.isArray(storeRows)) {
            result.stores = storeRows;
          }
        }
        await connection.end();

        console.log("<admin-record-fetched from MySQL>: ", result)

        // Check subscription validity
        const isPlanActive = checkSubscriptionValidity(result);

        if (!result) {
          res.status(404).json({ error: "Admin not found" });
          return;
        }
        const responseData = { ...result, isPlanActive };
        res.status(200).json(responseData);

        if (req.params._id.length > 0) {
          await redisClient.hSet("hashSet:admin:details", req.params._id, JSON.stringify(responseData));
          await redisClient.sAdd("set:admin:id", req.params._id)
        }
        return;
      } catch (e: Error | any) {
        res.status(500).json({ error: e.message });
      }
    });


  // Configure a new store for a seller
  app.post(
    "/configure-store",
    verifyClerkToken,
    async (req: Request, res: Response) => {
      try {
        const { sellerId, pincode, county, state, country, transaction_id } = req.body as {
          sellerId: string;
          pincode: string;
          county: string;
          transaction_id: string;
          state: string;
          country: string;
        };
        if (!sellerId || !pincode || !county || !state || !country) {
          res.status(400).json({ error: "All store fields are required" });
          return;
        }

        const connection = await mysql.createConnection({
          host: 'global_sql_data',
          port: 3306,
          user: 'root',
          database: 'xvstore'
        });

        // Check how many stores are allotted vs how many are configured
        const [subRows]: any = await connection.execute(
          'SELECT MAX(store_allotment) as max_allotment FROM seller_subscriptions WHERE seller_id = ?',
          [sellerId]
        );
        const maxAllotment: number = subRows[0]?.max_allotment ?? 1;

        const [existingRows]: any = await connection.execute(
          'SELECT COUNT(*) as count FROM store WHERE seller_id = ?',
          [sellerId]
        );
        const existingCount: number = existingRows[0]?.count ?? 0;

        if (existingCount >= maxAllotment) {
          await connection.end();
          res.status(403).json({ error: `Store limit of ${maxAllotment} reached for your subscription plan.` });
          return;
        }

        await connection.execute(
          'INSERT INTO store (seller_id,transaction_id, pincode, county, state, country) VALUES (?, ?, ?, ?, ?, ?)',
          [sellerId, transaction_id, pincode, county, state, country]
        );



        await connection.end();

        // Invalidate Redis admin cache so next fetch includes updated stores
        if (redisClient.isOpen) {
          await redisClient.hDel("hashSet:admin:details", sellerId);
        }

        res.status(201).json({ message: "Store configured successfully", maxAllotment, existingCount: Math.min(maxAllotment, existingCount + 1) });
      } catch (e: Error | any) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  //update admin new data
  app.patch(
    "/update-admin-info",
    verifyClerkToken,
    async (req: Request<{}, {}, AdminFieldsType>, res: Response, next: NextFunction) => {
      if (redisClient.isOpen) {
        if (await redisClient.sIsMember('set:admin:id', req.body._id)) {
          next();
          return;
        }
      }
      //now watching if record is in sanity.io else catfishing
      const record = await sanityClient.fetch(`*[_type=="admin" && _id==$adminId][0]`, {
        adminId: req.body._id
      });

      if (record != null) {
        if (redisClient.isOpen) {
          await redisClient.hSet('hashSet:admin:details', req.body._id, JSON.stringify(record))
          await redisClient.sAdd('set:admin:id', req.body._id)
        }
        next();
        return;
      }

      res.sendStatus(401);
    },
    async (req: Request<{}, {}, AdminFieldsType>, res: Response) => {
      const adminPayload: AdminFieldsType = req.body;
      const producer = kafka.producer();
      await producer.connect();

      producer.send({
        topic: "admin-update-topic",
        messages: [{ value: JSON.stringify(adminPayload) }],
      });
      await producer.disconnect();
    }
  );

  //get product list uploaded by an admin [redis + sanity]
  app.get(
    "/:_id/product-list",
    verifyClerkToken,
    async (req: Request<{ _id: string }>, res: Response) => {
      try {
        if (redisClient.isOpen) {
          const resultFromRedis = await redisClient.lRange(`productList:admin:${req.params._id}`, 0, -1);
        }
        const sanityClient: SanityClient = createClient(sanityConfig);
        const result = await sanityClient.fetch(
          `*[_type=="admin" && _id==$admin_id]{productReferenceAfterListing}`, {
          admin_id: req.params._id
        }
        )
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send(error);
      }
    }
  );

  //get dashboard metrics for an admin [redis + sanity]
  app.get(
    "/:_id/dashboard-metrics",
    verifyClerkToken,
    async (req: Request<{ _id: string }>, res: Response) => {
      try {
        const adminId = req.params._id;
        const { fromDate, toDate } = req.query;

        // Create cache key that includes date parameters if provided
        const cacheKey = fromDate && toDate
          ? `dashboardMetrics:admin:${adminId}:${fromDate}:${toDate}`
          : `dashboardMetrics:admin:${adminId}`;

        // Check Redis cache first (skip cache for date-filtered requests for now)
        if (redisClient.isOpen && !fromDate && !toDate) {
          const cachedMetrics = await redisClient.hGet(`dashboardMetrics:admin:${adminId}`, 'metrics');
          if (cachedMetrics) {
            console.log("<Redis dashboard metrics hit>");
            console.log(cachedMetrics);
            res.status(200).json(JSON.parse(cachedMetrics));
            return;
          }
        }

        // 1. Get Seller Pincode from Global DB to determine shard
        let sellerPincode: string | null = null;
        let shardHost = '';

        // Check Redis for cached seller state/details
        if (redisClient.isOpen) {
          const cachedAdmin = await redisClient.hGet("hashSet:admin:details", adminId);
          if (cachedAdmin) {
            try {
              const adminData = JSON.parse(cachedAdmin);
              sellerPincode = adminData.address?.pincode;
            } catch (e) {
              console.warn("DASHBOARD: Failed to parse cached admin data", e);
            }
          }
        }

        if (!sellerPincode) {
          const globalConnection = await mysql.createConnection({
            host: 'global_sql_data',
            port: 3306,
            user: 'root',
            database: 'xvstore'
          });

          const [rows]: any = await globalConnection.execute(
            'SELECT address_pincode FROM sellers WHERE id = ?',
            [adminId]
          );
          await globalConnection.end();

          if (Array.isArray(rows) && rows.length > 0) {
            sellerPincode = rows[0].address_pincode;
          }
        }

        const shardKey = sellerPincode || adminId;
        shardHost = ShardHelper.getShardHost(shardKey);

        // 2. Connect to the Seller's Shard
        const shardConnection = await mysql.createConnection({
          host: shardHost,
          port: 3306,
          user: 'root',
          database: 'xvstore'
        });

        // 3. Execute Metrics Queries on the Shard
        // Base where clause for date filters
        let dateFilter = '';
        const queryParams: any[] = [adminId];
        if (fromDate && toDate) {
          dateFilter = ' AND created_at BETWEEN ? AND ?';
          queryParams.push(fromDate, toDate);
        }

        // Total Sales & Products Sold
        const [salesRows]: any = await shardConnection.execute(`
          SELECT 
            SUM(so.total_amount) as totalSales,
            SUM(soi.quantity) as productsSold
          FROM seller_orders so
          LEFT JOIN (
            SELECT seller_order_id, SUM(quantity) as quantity 
            FROM seller_order_items 
            GROUP BY seller_order_id
          ) soi ON so.id = soi.seller_order_id
          WHERE so.seller_id = ? ${dateFilter}
        `, queryParams);

        // Orders Served (Assuming 'ready_to_ship' or any non-pending/non-rejected counts as "served" in this context)
        const [ordersServedRows]: any = await shardConnection.execute(`
          SELECT COUNT(*) as count 
          FROM seller_orders 
          WHERE seller_id = ? AND status NOT IN ('pending', 'rejected') ${dateFilter}
        `, queryParams);

        // Active Customers (Unique customers who have ordered)
        const [customerRows]: any = await shardConnection.execute(`
          SELECT COUNT(DISTINCT o.customer_id) as count
          FROM seller_orders so
          JOIN orders o ON so.order_id = o.id
          WHERE so.seller_id = ? ${dateFilter}
        `, queryParams);

        // Monthly Revenue (Current Month)
        const [monthlyRevRows]: any = await shardConnection.execute(`
          SELECT SUM(total_amount) as count
          FROM seller_orders
          WHERE seller_id = ? 
          AND MONTH(created_at) = MONTH(CURRENT_DATE()) 
          AND YEAR(created_at) = YEAR(CURRENT_DATE())
        `, [adminId]);

        await shardConnection.end();

        // 4. Aggregate Inventory across ALL shards (since products are sharded by productId)
        let totalProductsInInventory = 0;
        const shardHosts = ['mysql1', 'mysql2', 'mysql3', 'mysql4'];

        const inventoryPromises = shardHosts.map(async (host) => {
          try {
            const conn = await mysql.createConnection({
              host,
              port: 3306,
              user: 'root',
              database: 'xvstore'
            });
            const [rows]: any = await conn.execute(
              'SELECT COUNT(DISTINCT product_id) as count FROM seller_product_details WHERE seller_id = ?',
              [adminId]
            );
            await conn.end();
            return Number(rows[0]?.count || 0);
          } catch (err) {
            console.error(`Inventory check failed on ${host}:`, err);
            return 0;
          }
        });

        const inventoryResults = await Promise.all(inventoryPromises);
        totalProductsInInventory = inventoryResults.reduce((sum, h) => sum + h, 0);

        // 5. Finalize Metrics
        const totalSales = Number(salesRows[0]?.totalSales || 0);
        const productsSold = Number(salesRows[0]?.productsSold || 0);
        const totalProfit = Math.round(totalSales * 0.4);
        const ordersServed = Number(ordersServedRows[0]?.count || 0);
        const activeCustomers = Number(customerRows[0]?.count || 0);
        const monthlyRevenue = Number(monthlyRevRows[0]?.count || 0);

        const metrics = {
          totalSales: {
            value: `$${totalSales.toLocaleString()}`,
            trend: '+7.6% from last month',
            numericValue: totalSales
          },
          totalProfit: {
            value: `$${totalProfit.toLocaleString()}`,
            trend: '+8.3% from last month',
            numericValue: totalProfit
          },
          ordersServed: {
            value: ordersServed.toString(),
            trend: '+8.1% from last month',
            numericValue: ordersServed
          },
          activeCustomers: {
            value: activeCustomers.toLocaleString(),
            trend: '+12.4% from last month',
            numericValue: activeCustomers
          },
          monthlyRevenue: {
            value: `$${monthlyRevenue.toLocaleString()}`,
            trend: '+5.8% from last month',
            numericValue: monthlyRevenue
          },
          productsSold: {
            value: productsSold.toLocaleString(),
            trend: '+9.2% from last month',
            numericValue: productsSold
          },
          totalProductsInInventory: {
            value: totalProductsInInventory,
            trend: '+0% from last month',
            numericValue: totalProductsInInventory
          }
        };

        // Cache the result (only cache non-filtered requests)
        if (redisClient.isOpen && !fromDate && !toDate) {
          await redisClient.hSet(`dashboardMetrics:admin:${adminId}`, 'metrics', JSON.stringify(metrics));
          await redisClient.expire(`dashboardMetrics:admin:${adminId}`, 3600);
        }

        const response = {
          ...metrics,
          ...(fromDate && toDate && {
            dateRange: {
              from: fromDate,
              to: toDate,
              filtered: true
            }
          })
        };

        res.status(200).json(response);
      } catch (error: any) {
        console.error('Dashboard metrics error:', error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Fetch products endpoint - returns array of product objects for a seller
  app.get(
    "/:_id/fetch-products",
    verifyClerkToken,
    async (req: Request<{ _id: string }>, res: Response) => {
      try {
        const adminId = req.params._id;

        // Check Redis cache first
        if (redisClient.isOpen) {
          const cachedProducts = await redisClient.lRange(`productList:admin:${adminId}`, 0, -1);
          if (cachedProducts && cachedProducts.length > 0) {
            console.log("<Redis products hit>");
            const products = cachedProducts.map(product => JSON.parse(product));
            res.status(200).json(products);
            return;
          }
        }

        // Fetch from Sanity if not in cache
        const query = `*[_type=="product" && seller._ref==$adminId]{
          _id,
          productName,
          category,
          eanUpcIsbnGtinAsinType,
          eanUpcNumber,
          quantity,
          pincode,
          currency,
          price,
          keywords,
          imagesBase64,
          seller,
          productDescription,
          modelNumber,
          _createdAt,
          _updatedAt
        }`;

        const products = await sanityClient.fetch(query, { adminId });

        console.log(`Fetched ${products.length} products for admin ${adminId}`);

        // Cache the results in Redis
        if (redisClient.isOpen && products.length > 0) {
          const pipeline = redisClient.multi();

          // Clear existing cache
          pipeline.del(`productList:admin:${adminId}`);

          // Add all products to the list
          products.forEach((product: any) => {
            pipeline.rPush(`productList:admin:${adminId}`, JSON.stringify(product));
          });

          // Set expiration (1 hour)
          pipeline.expire(`productList:admin:${adminId}`, 3600);

          await pipeline.exec();
        }

        res.status(200).json(products);
      } catch (error: any) {
        console.error('Fetch products error:', error);
        res.status(500).json({ error: error.message });
      }
    }
  );

  // Fetch orders assigned to a seller
  app.get(
    "/seller-orders/:sellerId",
    verifyClerkToken,
    async (req: Request<{ sellerId: string }>, res: Response) => {
      console.log("<Fetching orders for seller>:", req.params.sellerId);
      try {
        const sellerId = req.params.sellerId;
        let shardHost = 'mysql1'; // default fallback

        // 1. Determine Shard Host based on Seller Address
        let sellerPincode: string | undefined;

        // Try Redis first
        if (redisClient.isOpen) {
          const cachedAdmin = await redisClient.hGet("hashSet:admin:details", sellerId);
          if (cachedAdmin) {
            try {
              const adminData = JSON.parse(cachedAdmin);
              sellerPincode = adminData.address?.pincode;
              console.log("Found seller pincode in Redis:", sellerPincode);
            } catch (e) {
              console.warn("Failed to parse cached admin data", e);
            }
          }
        }

        // If not in Redis (or no state), fetch from Global DB
        if (!sellerPincode) {
          console.log("Seller address not in cache, fetching from Global DB...");
          const globalConnection = await mysql.createConnection({
            host: 'global_sql_data',
            port: 3306,
            user: 'root',
            database: 'xvstore'
          });

          const [rows]: any = await globalConnection.execute(
            'SELECT address_pincode FROM sellers WHERE id = ?',
            [sellerId]
          );
          await globalConnection.end();

          if (Array.isArray(rows) && rows.length > 0) {
            sellerPincode = rows[0].address_pincode;
            console.log("Fetched seller pincode from Global DB:", sellerPincode);
          }
        }

        // Calculate Shard
        // Priority: Pincode -> ID (fallback)
        const shardKey = sellerPincode || sellerId;
        shardHost = ShardHelper.getShardHost(shardKey);
        console.log(`Routing to shard: ${shardHost} (based on: ${sellerPincode ? 'Pincode' : 'ID'})`);

        // 2. Connect to the correct Shard
        const connection = await mysql.createConnection({
          host: shardHost,
          port: 3306,
          user: 'root',
          database: 'xvstore'
        });

        // Query both seller_orders and their items
        const [rows] = await connection.execute(`
          SELECT 
            so.id,
            so.order_id,
            so.seller_id,
            so.status,
            so.total_amount,
            so.is_partial_fulfillment,
            so.notes,
            so.accepted_at,
            so.rejection_reason,
            so.created_at,
            soi.product_id,
            soi.quantity,
            soi.price
          FROM seller_orders so
          LEFT JOIN seller_order_items soi ON so.id = soi.seller_order_id
          WHERE so.seller_id = ?
          ORDER BY so.created_at DESC
        `, [sellerId]);

        await connection.end();

        const ordersMap = new Map();

        if (Array.isArray(rows)) {
          rows.forEach((row: any) => {
            if (!ordersMap.has(row.id)) {
              ordersMap.set(row.id, {
                _id: row.id,
                orderId: row.order_id,
                seller: {
                  _id: row.seller_id,
                  _ref: row.seller_id
                },
                status: row.status,
                totalAmount: Number(row.total_amount),
                isPartialFulfillment: Boolean(row.is_partial_fulfillment),
                notes: row.notes,
                acceptedAt: row.accepted_at,
                rejectionReason: row.rejection_reason,
                _createdAt: row.created_at,
                products: []
              });
            }

            if (row.product_id) {
              ordersMap.get(row.id).products.push({
                product: {
                  _id: row.product_id,
                  _ref: row.product_id
                },
                quantity: row.quantity,
                price: Number(row.price)
              });
            }
          });
        }

        const result = Array.from(ordersMap.values());
        console.log(`<Fetched ${result.length} orders for seller from ${shardHost}>`);
        res.status(200).json(result);
      } catch (err: any) {
        console.error("Error fetching seller orders:", err);
        res.status(500).json({ error: "Internal server error", details: err.message });
      }
    }
  );

  app.post("/fetch-mail-otp", (req: Request, res: Response) => {
    const OTP = Math.trunc(Math.random() * 10 ** 6);
    const worker = new Worker("./dist/EmailWorker.js", {
      workerData: {
        recipient: req.body?.recipient,
        confirmation: OTP,
      },
    });
    res.status(200).send("email sent successfully!")
  });

  app.post("/fetch-phone-otp", (req: Request, res: Response) => {
    const OTP = Math.trunc(Math.random() * 10 ** 6);
    const worker = new Worker("./dist/PhoneWorker.js", {
      workerData: {
        recipient: req.body?.phone,
        confirmation: OTP,
      },
    });

    res.send("SMS sent");
  });
  //#endregion 


  app.listen(Number(process.env.PORT) || 5003, "0.0.0.0", () =>
    console.log("listening on PORT:" + (process.env.PORT || 5003))
  );
}
