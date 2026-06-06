import { Worker } from "worker_threads";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { AdminFieldsType } from "./delcarations/AdminFieldType";
import { createClient, SanityClient } from '@sanity/client'
import { createClient as RedisClient } from "redis";
import { sanityConfig } from './utils/index.js';
import { Kafka, logLevel, Producer, RecordMetadata } from "kafkajs";
import { createTransport } from "nodemailer";
import { ClerkClient, verifyToken } from "@clerk/backend";
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
    }
    catch (err: any) {
      console.error("Error in admin creation endpoint: ", err);
      res.status(500).json({ error: "Internal server error!", details: err.message });
    } finally {
      await producer!.disconnect().catch(() => {});
      console.log("Kafka producer disconnected.");
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
          } else {
            // The subscription is not present in redis (maybe cache cleared),
            // but it might be in database and also active. We also include store check.
            const connection = await mysql.createConnection({
              host: 'global_sql_data',
              port: 3306,
              user: 'root',
              database: 'xvstore'
            });

            try {
              // Fetch subscriptions
              const [subRows] = await connection.execute('SELECT * FROM seller_subscriptions WHERE seller_id = ?', [req.params._id]);
              if (Array.isArray(subRows) && subRows.length > 0) {
                adminData.subscriptionPlan = subRows.map((sub: any) => ({
                  _key: sub.id,
                  transactionId: sub.transaction_id,
                  amount: sub.amount,
                  storeAllotment: sub.store_allotment ?? 1,
                  planSchemaList: {
                    activeDate: sub.plan_active_date,
                    expireDate: sub.plan_expire_date
                  }
                }));
                isPlanActive = checkSubscriptionValidity(adminData);
              }

              // Fetch configured stores for this seller (try seller_stores, fall back to store)
              try {
                const [storeRows] = await connection.execute(
                  'SELECT id, store_number, pincode, shard_host, county, state, country FROM seller_stores WHERE seller_id = ? ORDER BY store_number',
                  [req.params._id]
                );
                if (Array.isArray(storeRows)) {
                  adminData.stores = storeRows;
                }
              } catch (e: any) {
                const [storeRows] = await connection.execute(
                  'SELECT id, pincode, county, state, country FROM store WHERE seller_id = ?',
                  [req.params._id]
                );
                if (Array.isArray(storeRows)) {
                  adminData.stores = storeRows;
                }
              }
            } finally {
              await connection.end();
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
      try {
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

          // Fetch configured stores for this seller (try seller_stores, fall back to store)
          try {
            const [storeRows] = await connection.execute(
              'SELECT id, store_number, pincode, shard_host, county, state, country FROM seller_stores WHERE seller_id = ? ORDER BY store_number',
              [req.params._id]
            );
            if (Array.isArray(storeRows)) {
              result.stores = storeRows;
            }
          } catch (e: any) {
            const [storeRows] = await connection.execute(
              'SELECT id, pincode, county, state, country FROM store WHERE seller_id = ?',
              [req.params._id]
            );
            if (Array.isArray(storeRows)) {
              result.stores = storeRows;
            }
          }
        }

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
      } finally {
        await connection.end();
      }
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
      const { storeId, sellerId, pincode, county, state, country } = req.body as {
        storeId: string;
        sellerId: string;
        pincode: string;
        county: string;
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

      try {
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
          res.status(403).json({ error: `Store limit of ${maxAllotment} reached for your subscription plan.` });
          return;
        }

        const [pincodeCheck]: any = await connection.execute(
          'SELECT COUNT(*) as count FROM store WHERE pincode = ?',
          [pincode]
        );

        if (pincodeCheck[0]?.count > 0) {
          res.status(403).json({ error: `Store with pincode ${pincode} is already present in the store table.` });
          return;
        }

        await connection.execute(
          'INSERT INTO store (id, seller_id, pincode, county, state, country) VALUES (?, ?, ?, ?, ?, ?)',
          [Number(pincode), sellerId, pincode, county, state, country]
        );

        // Also insert into seller_stores with pre-computed shard_host (best-effort)
        try {
          const shardHost = ShardHelper.getShardHost(pincode);
          const nextStoreNumber = existingCount + 1;
          await connection.execute(
            'INSERT INTO seller_stores (seller_id, store_number, pincode, shard_host, county, state, country) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [sellerId, nextStoreNumber, pincode, shardHost, county, state, country]
          );
        } catch (e: any) {
          console.log(`seller_stores insert skipped (table may not exist): ${e.message}`);
        }

        // Invalidate Redis admin cache so next fetch includes updated stores
        if (redisClient.isOpen) {
          await redisClient.hDel("hashSet:admin:details", sellerId);
        }

        res.status(201).json({ message: "Store configured successfully", storeId: Number(storeId), maxAllotment, existingCount: Math.min(maxAllotment, existingCount + 1) });
      } catch (e: Error | any) {
        res.status(500).json({ error: e.message });
      } finally {
        await connection.end();
      }
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
    try {
      await producer.connect();

      await producer.send({
        topic: "admin-update-topic",
        messages: [{ value: JSON.stringify(adminPayload) }],
      });
      res.status(200).json({ message: 'Update queued' });
    } catch (err) {
      console.error('Error updating admin info:', err);
      res.status(500).json({ error: 'Failed to update admin' });
    } finally {
      await producer.disconnect().catch(() => {});
    }
  }
);

//get product list uploaded by an admin [redis + sanity]
app.get(
  "/:_id/product-list",
  verifyClerkToken,
  async (req: Request<{ _id: string }>, res: Response) => {
    try {
      // FIXED: resultFromRedis was fetched but never used - removed to avoid wasted memory
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

      // NOTE: Previously, dashboard metrics were cached in Redis. To ensure the latest data is always returned,
      // we have removed the cache lookup. The metrics will now be fetched directly from the database on every request.

      // 1. Get all shards this seller has data in
      const sellerShards = await ShardHelper.getSellerShards(adminId);
      console.log(`DASHBOARD: Seller ${adminId} has data in shards: ${sellerShards.join(', ')}`);

      // 2. Execute metrics queries across ALL seller shards in parallel
      const dateFilter = (fromDate && toDate) ? { from: fromDate, to: toDate } : null;

      const shardMetricPromises = sellerShards.map(async (shardHost) => {
        const conn = await mysql.createConnection({
          host: shardHost,
          port: 3306,
          user: 'root',
          database: 'xvstore'
        });

        try {
          // Total Sales & Products Sold
          const [salesRows]: any = await conn.execute(`
            SELECT 
              COALESCE(SUM(so.total_amount), 0) as totalSales,
              COALESCE(SUM(soi.quantity), 0) as productsSold
            FROM seller_orders so
            LEFT JOIN (
              SELECT seller_order_id, SUM(quantity) as quantity 
              FROM seller_order_items 
              GROUP BY seller_order_id
            ) soi ON so.id = soi.seller_order_id
            WHERE so.seller_id = ? ${dateFilter ? 'AND so.created_at BETWEEN ? AND ?' : ''}
          `, dateFilter ? [adminId, dateFilter.from, dateFilter.to] : [adminId]);

          // Orders Served (non-pending, non-rejected)
          const orderParams: any[] = [adminId];
          if (dateFilter) {
            orderParams.push(dateFilter.from, dateFilter.to);
          }
          const [ordersServedRows]: any = await conn.execute(`
            SELECT COUNT(*) as count 
            FROM seller_orders 
            WHERE seller_id = ? AND status NOT IN ('pending', 'rejected') ${dateFilter ? 'AND created_at BETWEEN ? AND ?' : ''}
          `, orderParams);

          // Active Customers
          const [customerRows]: any = await conn.execute(`
            SELECT COUNT(DISTINCT o.customer_id) as count
            FROM seller_orders so
            JOIN orders o ON so.order_id = o.id
            WHERE so.seller_id = ? ${dateFilter ? 'AND so.created_at BETWEEN ? AND ?' : ''}
          `, dateFilter ? [adminId, dateFilter.from, dateFilter.to] : [adminId]);

          // Monthly Revenue (Current Month) - from all shards
          const [monthlyRevRows]: any = await conn.execute(`
            SELECT COALESCE(SUM(total_amount), 0) as count
            FROM seller_orders
            WHERE seller_id = ? 
            AND MONTH(created_at) = MONTH(CURRENT_DATE()) 
            AND YEAR(created_at) = YEAR(CURRENT_DATE())
          `, [adminId]);

          // Time-series data
          const startDate = fromDate ? new Date(fromDate as string) : new Date(new Date().getFullYear(), 0, 1);
          const endDate = toDate ? new Date(toDate as string) : new Date();
          const [timeSeriesRows]: any = await conn.execute(`
            SELECT 
              DATE(created_at) as date,
              COALESCE(SUM(total_amount), 0) as totalSales,
              COUNT(*) as ordersCount
            FROM seller_orders
            WHERE seller_id = ? 
            AND created_at BETWEEN ? AND ?
            GROUP BY DATE(created_at)
            ORDER BY date ASC
          `, [adminId, startDate, endDate]);

          // Inventory count (distinct products)
          const [invRows]: any = await conn.execute(
            'SELECT COUNT(DISTINCT product_id) as count FROM seller_product_details WHERE seller_id = ?',
            [adminId]
          );

          return {
            totalSales: Number(salesRows[0]?.totalSales || 0),
            productsSold: Number(salesRows[0]?.productsSold || 0),
            ordersServed: Number(ordersServedRows[0]?.count || 0),
            activeCustomers: Number(customerRows[0]?.count || 0),
            monthlyRevenue: Number(monthlyRevRows[0]?.count || 0),
            totalProductsInInventory: Number(invRows[0]?.count || 0),
            timeSeriesRows
          };
        } catch (err) {
          console.error(`Dashboard metrics failed on ${shardHost}:`, err);
          return {
            totalSales: 0, productsSold: 0, ordersServed: 0,
            activeCustomers: 0, monthlyRevenue: 0, totalProductsInInventory: 0,
            timeSeriesRows: []
          };
        } finally {
          await conn.end();
        }
      });

      const shardMetrics = await Promise.all(shardMetricPromises);

      // 3. Aggregate results across shards
      const aggregated = shardMetrics.reduce((acc, m) => ({
        totalSales: acc.totalSales + m.totalSales,
        productsSold: acc.productsSold + m.productsSold,
        ordersServed: acc.ordersServed + m.ordersServed,
        activeCustomers: acc.activeCustomers + m.activeCustomers,
        monthlyRevenue: acc.monthlyRevenue + m.monthlyRevenue,
        totalProductsInInventory: acc.totalProductsInInventory + m.totalProductsInInventory
      }), {
        totalSales: 0, productsSold: 0, ordersServed: 0,
        activeCustomers: 0, monthlyRevenue: 0, totalProductsInInventory: 0
      });

      // Aggregate time-series: merge by date
      const timeSeriesMap = new Map<string, { totalSales: number; ordersCount: number }>();
      shardMetrics.forEach(m => {
        if (Array.isArray(m.timeSeriesRows)) {
          m.timeSeriesRows.forEach((row: any) => {
            const date = row.date as string;
            const existing = timeSeriesMap.get(date) || { totalSales: 0, ordersCount: 0 };
            timeSeriesMap.set(date, {
              totalSales: existing.totalSales + Number(row.totalSales || 0),
              ordersCount: existing.ordersCount + Number(row.ordersCount || 0)
            });
          });
        }
      });

      // Sort time-series by date
      const sortedDates = Array.from(timeSeriesMap.keys()).sort();
      const timeSeries = {
        labels: sortedDates,
        salesData: sortedDates.map(d => timeSeriesMap.get(d)!.totalSales),
        profitData: sortedDates.map(d => Math.round(timeSeriesMap.get(d)!.totalSales * 0.4)),
        ordersData: sortedDates.map(d => timeSeriesMap.get(d)!.ordersCount)
      };

      // 5. Finalize Metrics — use aggregated values from all shards
      const totalProfit = Math.round(aggregated.totalSales * 0.4);

      const metrics = {
        totalSales: {
          value: `$${aggregated.totalSales.toLocaleString()}`,
          trend: '+7.6% from last month',
          numericValue: aggregated.totalSales
        },
        totalProfit: {
          value: `$${totalProfit.toLocaleString()}`,
          trend: '+8.3% from last month',
          numericValue: totalProfit
        },
        ordersServed: {
          value: aggregated.ordersServed.toString(),
          trend: '+8.1% from last month',
          numericValue: aggregated.ordersServed
        },
        activeCustomers: {
          value: aggregated.activeCustomers.toLocaleString(),
          trend: '+12.4% from last month',
          numericValue: aggregated.activeCustomers
        },
        monthlyRevenue: {
          value: `$${aggregated.monthlyRevenue.toLocaleString()}`,
          trend: '+5.8% from last month',
          numericValue: aggregated.monthlyRevenue
        },
        productsSold: {
          value: aggregated.productsSold.toLocaleString(),
          trend: '+9.2% from last month',
          numericValue: aggregated.productsSold
        },
        totalProductsInInventory: {
          value: aggregated.totalProductsInInventory,
          trend: '+0% from last month',
          numericValue: aggregated.totalProductsInInventory
        }
      };

      // NOTE: Previously, the computed metrics were cached in Redis. This has been removed to avoid stale data.

      const response = {
        ...metrics,
        timeSeries,
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

// Fetch products endpoint
// Uses the same hash algorithm as product storage: hash the store's pincode via
// ShardHelper.getShardHost(pincode) to determine which shard the products are in.
// Groups stores by shard so only the relevant shard is queried per store.
app.get(
  "/:_id/fetch-products",
  verifyClerkToken,
  async (req: Request<{ _id: string }>, res: Response) => {
    try {
      const adminId = req.params._id;

      // 1. Fetch seller's configured stores for display metadata (grouping by pincode)
      const globalConn = await mysql.createConnection({
        host: 'global_sql_data',
        port: 3306,
        user: 'root',
        database: 'xvstore'
      });

      let stores: any[] = [];
      try {
        const [storeRows] = await globalConn.execute(
          'SELECT id, store_number, pincode, county, state, country FROM seller_stores WHERE seller_id = ? ORDER BY store_number',
          [adminId]
        );
        stores = (storeRows as any[]);
      } catch (e: any) {
        // seller_stores table doesn't exist — fall back to old store table
        const [storeRows] = await globalConn.execute(
          'SELECT id, pincode, county, state, country FROM store WHERE seller_id = ?',
          [adminId]
        );
        stores = (storeRows as any[]).map((s: any) => ({ ...s, pincode: String(s.pincode) }));
      }
      await globalConn.end();

      // 2. Products are sharded by STORE PINCODE hash, not by product ID.
      //    All products from the same store (same pincode) land in the same shard.
      //    We use seller_stores to get each store's pincode and compute its shard,
      //    then only query that specific shard per store instead of all seller shards.
      const sellerShards = await ShardHelper.getSellerShards(adminId);
      console.log(`FETCH-PRODUCTS: Seller ${adminId} has data in shards: ${sellerShards.join(', ')}`);

      if (sellerShards.length === 0) {
        res.status(200).json([]);
        return;
      }

      // 3. Group stores by their computed shard host so we only query the correct shard per store.
      //    With pincode-based routing, store at pincode 123456 always routes to the same shard.
      const targetShards = sellerShards.map(host => ({ shardHost: host, pincodes: [] as string[] }));

      // 4. Query each target shard in parallel
      const shardQueries = targetShards.map(async ({ shardHost, pincodes }) => {
        const shardIndex = parseInt(shardHost.replace('mysql', '')) - 1;
        const connection = await mysql.createConnection({
          host: shardHost,
          port: 3306,
          user: 'root',
          database: 'xvstore'
        });

        try {
          let rows: any[];
          if (pincodes.length > 0) {
            // Pincode-based: query only products in this store's pincodes
            // Both product data AND seller_product_details live in the same shard (routed by pincode)
            const placeholders = pincodes.map(() => '?').join(',');
            [rows] = await (connection.execute(`
              SELECT 
                p.id,
                p.product_name,
                p.ean_upc_type,
                p.ean_upc_number,
                p.category,
                p.model_number,
                p.product_description,
                p.price_currency,
                p.price_amount,
                p.price_discount_percentage,
                spd.seller_id,
                spd.quantity,
                spd.pincode,
                p.created_at,
                p.updated_at
              FROM products p
              JOIN seller_product_details spd ON p.id = spd.product_id
              WHERE spd.seller_id = ? AND spd.pincode IN (${placeholders})
            `, [adminId, ...pincodes]) as any);
          } else {
            // Fallback: query by seller_id only (no pincode filter)
            [rows] = await (connection.execute(`
              SELECT 
                p.id,
                p.product_name,
                p.ean_upc_type,
                p.ean_upc_number,
                p.category,
                p.model_number,
                p.product_description,
                p.price_currency,
                p.price_amount,
                p.price_discount_percentage,
                spd.seller_id,
                spd.quantity,
                spd.pincode,
                p.created_at,
                p.updated_at
              FROM products p
              JOIN seller_product_details spd ON p.id = spd.product_id
              WHERE spd.seller_id = ?
            `, [adminId]) as any);
          }

          rows = rows as any[];

          // Fetch images and keywords for these products
          const productIds = [...new Set(rows.map(r => r.id as string))];
          let imageRows: any[] = [];
          let keywordRows: any[] = [];

          if (productIds.length > 0) {
            const pPlaceholders = productIds.map(() => '?').join(',');
            [imageRows] = await (connection.execute(
              `SELECT product_id, size, base64, extension FROM product_images WHERE product_id IN (${pPlaceholders})`,
              productIds
            ) as any);
            [keywordRows] = await (connection.execute(
              `SELECT product_id, keyword FROM product_keywords WHERE product_id IN (${pPlaceholders})`,
              productIds
            ) as any);
          }

          return { shardHost, shardIndex, rows, imageRows: imageRows as any[], keywordRows: keywordRows as any[] };
        } catch (err) {
          console.error(`Product fetch failed on ${shardHost}:`, err);
          return { shardHost, shardIndex, rows: [], imageRows: [], keywordRows: [] };
        } finally {
          await connection.end();
        }
      });

      const shardResults = await Promise.all(shardQueries);

      // 5. Build image/keyword lookup maps
      const imageMap = new Map<string, any[]>();
      const keywordsMap = new Map<string, string[]>();

      shardResults.forEach(({ imageRows, keywordRows }) => {
        (imageRows as any[]).forEach((row: any) => {
          if (!imageMap.has(row.product_id)) imageMap.set(row.product_id, []);
          imageMap.get(row.product_id)!.push({ size: row.size, base64: row.base64, extension: row.extension });
        });
        (keywordRows as any[]).forEach((row: any) => {
          if (!keywordsMap.has(row.product_id)) keywordsMap.set(row.product_id, []);
          keywordsMap.get(row.product_id)!.push(row.keyword);
        });
      });

      // 6. Build a per-pincode map of products (deduplicated by product_id)
      const productsByPincode = new Map<string, any[]>();

      shardResults.forEach(({ rows }) => {
        (rows as any[]).forEach((row: any) => {
          const pc = String(row.pincode);
          if (!productsByPincode.has(pc)) {
            productsByPincode.set(pc, []);
          }

          const existing = productsByPincode.get(pc)!;
          const dup = existing.find((p: any) => p._id === row.id);
          if (!dup) {
            existing.push({
              _id: row.id,
              productName: row.product_name,
              category: row.category,
              eanUpcIsbnGtinAsinType: row.ean_upc_type,
              eanUpcNumber: row.ean_upc_number,
              quantity: row.quantity,
              pincode: pc,
              currency: row.price_currency || 'INR',
              price: {
                pdtPrice: Number(row.price_amount),
                discountPercentage: Number(row.price_discount_percentage),
                currency: row.price_currency || 'INR'
              },
              productDescription: row.product_description,
              modelNumber: row.model_number,
              seller: row.seller_id,
              imagesBase64: imageMap.get(row.id) || [],
              keywords: keywordsMap.get(row.id) || [],
              _createdAt: row.created_at,
              _updatedAt: row.updated_at
            });
          }
        });
      });

      // 7. Build store-grouped response — group products by pincode and match to stores
      const storeGroups: any[] = [];
      const storeByPincode = new Map<string, any>();
      stores.forEach(s => storeByPincode.set(String(s.pincode), s));

      if (productsByPincode.size > 0) {
        productsByPincode.forEach((products, pincode) => {
          const store = storeByPincode.get(pincode);
          const shardHost = ShardHelper.getShardHost(pincode); // hash for display/deterministic, not for routing
          const shardIndex = parseInt(shardHost.replace('mysql', '')) - 1;
          storeGroups.push({
            storeInfo: store ? {
              id: store.id,
              store_number: store.store_number || 0,
              pincode,
              county: store.county,
              state: store.state,
              country: store.country
            } : {
              id: Number(pincode),
              pincode,
              county: '',
              state: '',
              country: ''
            },
            shardHost,
            shardIndex,
            products
          });
        });
      } else {
        // No products found — return empty list with store info if available
        stores.forEach(store => {
          const pincode = String(store.pincode);
          const shardHost = ShardHelper.getShardHost(pincode);
          const shardIndex = parseInt(shardHost.replace('mysql', '')) - 1;
          storeGroups.push({
            storeInfo: {
              id: store.id,
              store_number: store.store_number || 0,
              pincode,
              county: store.county,
              state: store.state,
              country: store.country
            },
            shardHost,
            shardIndex,
            products: []
          });
        });
      }

      const totalProducts = storeGroups.reduce((sum, g) => sum + g.products.length, 0);
      console.log(`Fetched ${totalProducts} products across ${storeGroups.length} store(s) for seller ${adminId}`);

      res.status(200).json(storeGroups);
    } catch (error: any) {
      console.error('Fetch products error:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Fetch orders assigned to a seller — queries ALL shards where seller has data
app.get(
  "/seller-orders/:sellerId",
  verifyClerkToken,
  async (req: Request<{ sellerId: string }>, res: Response) => {
    console.log("<Fetching orders for seller>:", req.params.sellerId);
    try {
      const sellerId = req.params.sellerId;

      // 1. Get all shards this seller has data in
      const sellerShards = await ShardHelper.getSellerShards(sellerId);
      console.log(`Seller ${sellerId} has data in shards: ${sellerShards.join(', ')}`);

      // 2. Query ALL shards in parallel
      const shardQueries = sellerShards.map(async (shardHost) => {
        const connection = await mysql.createConnection({
          host: shardHost,
          port: 3306,
          user: 'root',
          database: 'xvstore'
        });

        try {
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

          return { shardHost, rows: rows as any[] };
        } catch (err) {
          console.error(`Order fetch failed on ${shardHost}:`, err);
          return { shardHost, rows: [] };
        } finally {
          await connection.end();
        }
      });

      const shardResults = await Promise.all(shardQueries);

      // 3. Merge results from all shards, deduplicating by order ID
      const ordersMap = new Map();

      shardResults.forEach(({ rows }) => {
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
      });

      // 4. Sort merged results by creation date (newest first)
      const result = Array.from(ordersMap.values())
        .sort((a: any, b: any) => new Date(b._createdAt).getTime() - new Date(a._createdAt).getTime());

      console.log(`<Fetched ${result.length} orders for seller across ${sellerShards.length} shard(s)>`);
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
  worker.on("error", (err) => {
    console.error("Email worker error:", err);
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
  worker.on("error", (err) => {
    console.error("SMS worker error:", err);
  });

  res.send("SMS sent");
});
//#endregion 


app.listen(Number(process.env.PORT) || 5003, "0.0.0.0", () =>
  console.log("listening on PORT:" + (process.env.PORT || 5003))
);