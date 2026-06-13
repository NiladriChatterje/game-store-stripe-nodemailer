import { Worker } from "worker_threads";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { AdminFieldsType } from "./delcarations/AdminFieldType";
import { createClient as RedisClient } from "redis";
import { Kafka, logLevel, Producer, RecordMetadata } from "kafkajs";
import { createTransport } from "nodemailer";
import { verifyToken } from "@clerk/backend";
import { JwtPayload } from "@clerk/types";
import mysql from 'mysql2/promise';
import { ShardHelper } from './utils/ShardHelper.js';
import { GLOBAL_DB_CONFIG } from './utils/index.js';

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
const redisClient = RedisClient({
  url: 'redis://redis_storage:6379'
});

// MySQL Global DB Pool
const globalPool = mysql.createPool({
  ...GLOBAL_DB_CONFIG,
  waitForConnections: true,
  connectionLimit: 2,
  queueLimit: 10
});

// Shard connection helper (mirrors PRODUCT_SHARDS_CONFIG from consumers)
const SHARD_HOSTS = ['mysql1', 'mysql2', 'mysql3', 'mysql4', 'mysql5'];

async function getShardConnection(shardHost: string): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: shardHost,
    port: 3306,
    user: 'root',
    database: 'xvstore'
  });
}

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
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    if (!process.env.CLERK_SECRET_KEY) {
      res.status(500).json({ error: 'Server misconfiguration: missing CLERK_SECRET_KEY' });
      return;
    }

    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      clockSkewInMs: 300000,
    });

    req.auth = payload;
    next();
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : String(error);
    const name = typeof error?.name === 'string' ? error.name : '';

    // Handle Clerk/JWK resolution failures (ex: "Failed to resolve JWK during verification") safely.
    const isJwkResolutionIssue = message.includes('JWK') || message.includes('jwks') || message.includes('Failed to resolve JWK');
    const isJwtIssue = message.toLowerCase().includes('jwt') || name.toLowerCase().includes('jwt');

    console.error('Token verification failed:', { name, message });

    if (isJwkResolutionIssue || isJwtIssue) {
      res.status(403).json({ error: 'Invalid token', details: 'Token could not be verified (JWK/JWT issue).' });
      return;
    }

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

  const currentTime = new Date().getTime();
  console.log("inside checkSubscriptionValidity function ::: ", adminData.subscriptionPlan);
  for (const plan of adminData.subscriptionPlan) {
    if (plan?.planSchemaList?.expireDate) {
      const expireTime = new Date(plan.planSchemaList.expireDate).getTime();
      console.log("Checking plan with expire date:", plan.planSchemaList.expireDate);
      if (expireTime > currentTime) {
        return true;
      }
    }
  }

  return false;
}
//#endregion

//#region Helper to fetch stores for a seller (shared by Redis & MySQL fetch paths)
async function fetchStoresForSeller(sellerId: string): Promise<any[]> {
  try {
    const [storeRows] = await globalPool.execute(
      'SELECT id, store_number, pincode, shard_host, store_name, address_line1, address_line2, county, state, country FROM seller_stores WHERE seller_id = ? ORDER BY store_number',
      [sellerId]
    );
    if (Array.isArray(storeRows)) {
      return storeRows as any[];
    }
  } catch {
    // seller_stores table may not exist; fall back to legacy store table
  }

  try {
    const [storeRows] = await globalPool.execute(
      'SELECT id, store_name, address_line1, address_line2, pincode, county, state, country FROM store WHERE seller_id = ?',
      [sellerId]
    );
    if (Array.isArray(storeRows)) {
      return storeRows as any[];
    }
  } catch {
    // legacy store table may not exist either
  }

  return [];
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


//get admin credential [redis + MySQL]
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

          // Fetch stores from MySQL — always needed regardless of where subscription data comes from
          const stores = await fetchStoresForSeller(req.params._id);
          if (stores.length > 0) {
            adminData.stores = stores;
          }

          if (subscriptionPlan) {
            const planData = JSON.parse(subscriptionPlan);
            const planExpireDate = planData.planExpireDate;
            const currentTime = new Date().getTime();
            const expireTime = new Date(planExpireDate).getTime();
            if (expireTime > currentTime) {
              isPlanActive = true;

              if (!adminData.subscriptionPlan || adminData.subscriptionPlan.length === 0) {
                adminData.subscriptionPlan = [{
                  transactionId: planData.transactionId,
                  orderId: planData.orderId,
                  paymentSignature: planData.paymentSignature,
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
            const connection = await mysql.createConnection({
              host: 'global_sql_data',
              port: 3306,
              user: 'root',
              database: 'xvstore'
            });

            try {
              const [subRows] = await connection.execute('SELECT * FROM seller_subscriptions WHERE seller_id = ?', [req.params._id]);
              if (Array.isArray(subRows) && subRows.length > 0) {
                adminData.subscriptionPlan = subRows.map((sub: any) => ({
                  _key: sub.id,
                  transactionId: sub.transaction_id,
                  orderId: sub.order_id,
                  paymentSignature: sub.payment_signature,
                  amount: sub.amount,
                  storeAllotment: sub.store_allotment ?? 1,
                  planSchemaList: {
                    activeDate: sub.plan_active_date,
                    expireDate: sub.plan_expire_date
                  }
                }));
                isPlanActive = checkSubscriptionValidity(adminData);
              }
            } finally {
              await connection.end();
            }
          }

          const freshResponse = { ...adminData, isPlanActive };
          res.json(freshResponse);

          // Refresh Redis cache with stores included (fire-and-forget)
          redisClient.hSet("hashSet:admin:details", req.params._id, JSON.stringify(freshResponse)).catch(() => {});
          return;
        }
      }
      // MySQL query
      const [rows] = await globalPool.execute('SELECT * FROM sellers WHERE id = ?', [req.params._id]);
      console.log("<MySQL admin data from sql> : ", rows);
      let result: any = null;
      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0] as any;
        result = {
          _id: row.id,
          _type: 'admin',
          username: row.username,
          gstin: row.gstin,
          email: row.email,
          phone: row.phone,
          geoPoint: row.geo_lat != null && row.geo_lng != null ? {
            lat: row.geo_lat,
            lng: row.geo_lng
          } : undefined,
          address: {
            pincode: row.address_pincode,
            county: row.address_county,
            state: row.address_state,
            country: row.address_country
          },
          subscriptionPlan: []
        };

        const [subRows] = await globalPool.execute('SELECT * FROM seller_subscriptions WHERE seller_id = ?', [req.params._id]);

        if (Array.isArray(subRows) && subRows.length > 0) {
          result.subscriptionPlan = subRows.map((sub: any) => ({
            _key: sub.id,
            transactionId: sub.transaction_id,
            orderId: sub.order_id,
            paymentSignature: sub.payment_signature,
            amount: sub.amount,
            storeAllotment: sub.store_allotment ?? 1,
            planSchemaList: {
              activeDate: sub.plan_active_date,
              expireDate: sub.plan_expire_date
            }
          }));
        }

        // Use the shared fetchStoresForSeller helper for consistency
        const stores = await fetchStoresForSeller(req.params._id);
        if (stores.length > 0) {
          result.stores = stores;
        }
      }

      console.log("<admin-record-fetched from MySQL>: ", result)

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
      return;
    }
  });


// Configure a new store for a seller
app.post(
  "/configure-store",
  verifyClerkToken,
  async (req: Request, res: Response) => {
    try {
      const { storeId, sellerId, store_name, address_line1, address_line2, pincode, county, state, country } = req.body as {
        storeId: string;
        sellerId: string;
        store_name: string;
        address_line1: string;
        address_line2?: string;
        pincode: string;
        county: string;
        state: string;
        country: string;
      };
      if (!sellerId || !store_name || !address_line1 || !pincode || !county || !state || !country) {
        res.status(400).json({ error: "All required store fields are missing" });
        return;
      }

      const connection = await mysql.createConnection({
        host: 'global_sql_data',
        port: 3306,
        user: 'root',
        database: 'xvstore'
      });

      try {
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
          'INSERT INTO store (id, seller_id, store_name, address_line1, address_line2, pincode, county, state, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [Number(pincode), sellerId, store_name, address_line1, address_line2 ?? '', pincode, county, state, country]
        );

        const shardHost = ShardHelper.getShardHost(pincode);
        const nextStoreNumber = existingCount + 1;
        let sellerStoresInserted = false;

        try {
          await connection.execute(
            'INSERT INTO seller_stores (seller_id, store_number, pincode, shard_host, store_name, address_line1, address_line2, county, state, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [sellerId, nextStoreNumber, pincode, shardHost, store_name, address_line1, address_line2 ?? '', county, state, country]
          );
          sellerStoresInserted = true;
        } catch (e: any) {
          console.log(`seller_stores insert skipped (table may not exist): ${e.message}`);
        }

        // Update Redis cache with the new store — avoids a MySQL round trip on next fetch
        if (redisClient.isOpen) {
          try {
            const existingJson = await redisClient.hGet("hashSet:admin:details", sellerId);
            if (existingJson) {
              const adminData = JSON.parse(existingJson);
              const stores = adminData.stores ?? [];
              const newStore: Record<string, any> = {
                id: Number(pincode),
                pincode,
                store_name,
                address_line1,
                address_line2: address_line2 ?? '',
                county,
                state,
                country,
              };
              if (sellerStoresInserted) {
                newStore.store_number = nextStoreNumber;
                newStore.shard_host = shardHost;
              }
              stores.push(newStore);
              adminData.stores = stores;
              await redisClient.hSet("hashSet:admin:details", sellerId, JSON.stringify(adminData));
              console.log(`[configure-store] Redis cache updated with new store for ${sellerId}`);
            }
          } catch (redisErr) {
            console.warn('[configure-store] Failed to update Redis cache:', redisErr);
          }
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
    try {
      if (redisClient.isOpen) {
        if (await redisClient.sIsMember('set:admin:id', req.body._id)) {
          next();
          return;
        }
      }
      // Check MySQL global DB — try the raw _id first
      const [adminRows] = await globalPool.execute(
        'SELECT id FROM sellers WHERE id = ?',
        [req.body._id]
      );

      if (Array.isArray(adminRows) && adminRows.length > 0) {
        if (redisClient.isOpen) {
          await redisClient.sAdd('set:admin:id', req.body._id);
        }
        next();
        return;
      }

      // Fallback: try with seller- prefix (DB stores IDs as seller-{ClerkId})
      // This handles the case where the frontend sends the raw Clerk ID without the prefix.
      if (!req.body._id.startsWith('seller-')) {
        const prefixedId = `seller-${req.body._id}`;
        const [prefixedRows] = await globalPool.execute(
          'SELECT id FROM sellers WHERE id = ?',
          [prefixedId]
        );
        if (Array.isArray(prefixedRows) && prefixedRows.length > 0) {
          if (redisClient.isOpen) {
            await redisClient.sAdd('set:admin:id', prefixedId);
          }
          next();
          return;
        }
      }

      // Admin not found — this is a new admin; fall through to create
      res.locals.isNewAdmin = true;
      next();
    } catch (e) {
      console.error('Error checking admin existence in /update-admin-info:', e);
      res.status(500).json({ error: 'Failed to verify admin status' });
    }
  },
  async (req: Request<{}, {}, AdminFieldsType>, res: Response) => {
    const adminPayload: AdminFieldsType = req.body;
    const isNew = res.locals.isNewAdmin === true;
    const topic = isNew ? "admin-create-topic" : "admin-update-topic";

    const producer = kafka.producer();
    try {
      await producer.connect();

      await producer.send({
        topic,
        messages: [{ value: JSON.stringify(adminPayload) }],
      });
      res.status(200).json({ message: isNew ? 'Account creation queued' : 'Update queued' });
    } catch (err) {
      console.error('Error sending admin info to Kafka:', err);
      res.status(500).json({ error: 'Failed to process admin info' });
    } finally {
      await producer.disconnect().catch(() => {});
    }
  }
);

//get product list uploaded by an admin [MySQL]
app.get(
  "/:_id/product-list",
  verifyClerkToken,
  async (req: Request<{ _id: string }>, res: Response) => {
    try {
      const sellerId = req.params._id;
      const sellerShards = await ShardHelper.getSellerShards(sellerId);

      const shardQueries = sellerShards.map(async (shardHost) => {
        const connection = await getShardConnection(shardHost);
        try {
          const [rows] = await connection.execute(
            `SELECT p.id, p.product_name, p.category, p.price_amount, p.created_at
             FROM products p
             JOIN seller_product_details spd ON p.id = spd.product_id
             WHERE spd.seller_id = ?
             GROUP BY p.id
             ORDER BY p.created_at DESC`,
            [sellerId]
          );
          return rows;
        } finally {
          await connection.end();
        }
      });

      const shardResults = await Promise.all(shardQueries);
      // Deduplicate by product id (same product may appear across shards)
      const seen = new Set<string>();
      const merged: any[] = [];
      for (const rows of shardResults) {
        for (const row of (rows as any[])) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            merged.push(row);
          }
        }
      }
      res.status(200).json(merged);
    } catch (error) {
      res.status(500).send(error);
    }
  }
);

//get dashboard metrics for an admin
app.get(
  "/:_id/dashboard-metrics",
  verifyClerkToken,
  async (req: Request<{ _id: string }>, res: Response) => {
    try {
      const adminId = req.params._id;
      const { fromDate, toDate } = req.query;

      const sellerShards = await ShardHelper.getSellerShards(adminId);
      console.log(`DASHBOARD: Seller ${adminId} has data in shards: ${sellerShards.join(', ')}`);

      const dateFilter = (fromDate && toDate) ? { from: fromDate, to: toDate } : null;

      const shardMetricPromises = sellerShards.map(async (shardHost) => {
        const conn = await mysql.createConnection({
          host: shardHost,
          port: 3306,
          user: 'root',
          database: 'xvstore'
        });

        try {
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

          const orderParams: any[] = [adminId];
          if (dateFilter) {
            orderParams.push(dateFilter.from, dateFilter.to);
          }
          const [ordersServedRows]: any = await conn.execute(`
            SELECT COUNT(*) as count 
            FROM seller_orders 
            WHERE seller_id = ? AND status NOT IN ('pending', 'rejected') ${dateFilter ? 'AND created_at BETWEEN ? AND ?' : ''}
          `, orderParams);

          const [customerRows]: any = await conn.execute(`
            SELECT COUNT(DISTINCT o.customer_id) as count
            FROM seller_orders so
            JOIN orders o ON so.order_id = o.id
            WHERE so.seller_id = ? ${dateFilter ? 'AND so.created_at BETWEEN ? AND ?' : ''}
          `, dateFilter ? [adminId, dateFilter.from, dateFilter.to] : [adminId]);

          const [monthlyRevRows]: any = await conn.execute(`
            SELECT COALESCE(SUM(total_amount), 0) as count
            FROM seller_orders
            WHERE seller_id = ? 
            AND MONTH(created_at) = MONTH(CURRENT_DATE()) 
            AND YEAR(created_at) = YEAR(CURRENT_DATE())
          `, [adminId]);

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

      const sortedDates = Array.from(timeSeriesMap.keys()).sort();
      const timeSeries = {
        labels: sortedDates,
        salesData: sortedDates.map(d => timeSeriesMap.get(d)!.totalSales),
        profitData: sortedDates.map(d => Math.round(timeSeriesMap.get(d)!.totalSales * 0.4)),
        ordersData: sortedDates.map(d => timeSeriesMap.get(d)!.ordersCount)
      };

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
app.get(
  "/:_id/fetch-products",
  verifyClerkToken,
  async (req: Request<{ _id: string }>, res: Response) => {
    try {
      const adminId = req.params._id;

      const globalConn = await mysql.createConnection({
        host: 'global_sql_data',
        port: 3306,
        user: 'root',
        database: 'xvstore'
      });

      let stores: any[] = [];
      try {
        const [storeRows] = await globalConn.execute(
          'SELECT id, store_number, pincode, shard_host, store_name, address_line1, address_line2, county, state, country FROM seller_stores WHERE seller_id = ? ORDER BY store_number',
          [adminId]
        );
        stores = (storeRows as any[]);
      } catch (e: any) {
        const [storeRows] = await globalConn.execute(
          'SELECT id, store_name, address_line1, address_line2, pincode, county, state, country FROM store WHERE seller_id = ?',
          [adminId]
        );
        stores = (storeRows as any[]).map((s: any) => ({ ...s, pincode: String(s.pincode) }));
      }
      await globalConn.end();

      const sellerShards = await ShardHelper.getSellerShards(adminId);
      console.log(`FETCH-PRODUCTS: Seller ${adminId} has data in shards: ${sellerShards.join(', ')}`);

      if (sellerShards.length === 0) {
        res.status(200).json([]);
        return;
      }

      const targetShards = sellerShards.map(host => ({ shardHost: host, pincodes: [] as string[] }));

      const shardQueries = targetShards.map(async ({ shardHost, pincodes }) => {
        const connection = await mysql.createConnection({
          host: shardHost,
          port: 3306,
          user: 'root',
          database: 'xvstore'
        });

        try {
          let rows: any[];
          if (pincodes.length > 0) {
            const placeholders = pincodes.map(() => '?').join(',');
            [rows] = await (connection.execute(`
              SELECT 
                p.id, p.product_name, p.ean_upc_type, p.ean_upc_number,
                p.category, p.model_number, p.product_description,
                p.price_currency, p.price_amount, p.price_discount_percentage,
                spd.seller_id, spd.quantity, spd.pincode,
                p.created_at, p.updated_at
              FROM products p
              JOIN seller_product_details spd ON p.id = spd.product_id
              WHERE spd.seller_id = ? AND spd.pincode IN (${placeholders})
            `, [adminId, ...pincodes]) as any);
          } else {
            [rows] = await (connection.execute(`
              SELECT 
                p.id, p.product_name, p.ean_upc_type, p.ean_upc_number,
                p.category, p.model_number, p.product_description,
                p.price_currency, p.price_amount, p.price_discount_percentage,
                spd.seller_id, spd.quantity, spd.pincode,
                p.created_at, p.updated_at
              FROM products p
              JOIN seller_product_details spd ON p.id = spd.product_id
              WHERE spd.seller_id = ?
            `, [adminId]) as any);
          }

          rows = rows as any[];

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

          return { shardHost, rows, imageRows: imageRows as any[], keywordRows: keywordRows as any[] };
        } catch (err) {
          console.error(`Product fetch failed on ${shardHost}:`, err);
          return { shardHost, rows: [], imageRows: [], keywordRows: [] };
        } finally {
          await connection.end();
        }
      });

      const shardResults = await Promise.all(shardQueries);

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

      const productsByPincode = new Map<string, any[]>();
      // Track which shard each pincode's products were found in
      const shardByPincode = new Map<string, string>();

      shardResults.forEach(({ shardHost, rows }) => {
        (rows as any[]).forEach((row: any) => {
          const pc = String(row.pincode);
          if (!productsByPincode.has(pc)) {
            productsByPincode.set(pc, []);
          }
          // Record the shard this pincode maps to (first occurrence wins)
          if (!shardByPincode.has(pc)) {
            shardByPincode.set(pc, shardHost);
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

      const storeGroups: any[] = [];
      const storeByPincode = new Map<string, any>();
      stores.forEach(s => storeByPincode.set(String(s.pincode), s));

      if (productsByPincode.size > 0) {
        productsByPincode.forEach((products, pincode) => {
          const store = storeByPincode.get(pincode);
          storeGroups.push({
            storeInfo: store ? {
              id: store.id,
              store_number: store.store_number || 0,
              pincode,
              shard_host: store.shard_host || shardByPincode.get(pincode) || '',
              county: store.county,
              state: store.state,
              country: store.country
            } : {
              id: Number(pincode),
              pincode,
              shard_host: shardByPincode.get(pincode) || '',
              county: '',
              state: '',
              country: ''
            },
            products
          });
        });
      } else {
        stores.forEach(store => {
          const pincode = String(store.pincode);
          storeGroups.push({
            storeInfo: {
              id: store.id,
              store_number: store.store_number || 0,
              pincode,
              shard_host: store.shard_host || '',
              county: store.county,
              state: store.state,
              country: store.country
            },
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

// Fetch orders assigned to a seller (enhanced with pincode & shipping info)
app.get(
  "/seller-orders/:sellerId",
  verifyClerkToken,
  async (req: Request<{ sellerId: string }>, res: Response) => {
    console.log("<Fetching orders for seller>:", req.params.sellerId);
    try {
      const sellerId = req.params.sellerId;

      const sellerShards = await ShardHelper.getSellerShards(sellerId);
      console.log(`Seller ${sellerId} has data in shards: ${sellerShards.join(', ')}`);

      const shardQueries = sellerShards.map(async (shardHost) => {
        const connection = await mysql.createConnection({
          host: shardHost,
          port: 3306,
          user: 'root',
          database: 'xvstore'
        });

        try {
          // First fetch pincode for each seller_order via seller_product_details
          // Also fetch shipping assignments
          const [rows] = await connection.execute(`
            SELECT 
              so.id, so.order_id, so.seller_id, so.status,
              so.total_amount, so.is_partial_fulfillment, so.notes,
              so.accepted_at, so.rejection_reason, so.created_at,
              soi.product_id, soi.quantity, soi.price,
              so.pincode
            FROM seller_orders so
            LEFT JOIN seller_order_items soi ON so.id = soi.seller_order_id
            WHERE so.seller_id = ?
            ORDER BY so.created_at DESC
          `, [sellerId]);

          // Fetch shipping assignments from THE SAME SHARD
          const orderIds = [...new Set((rows as any[]).map((r: any) => r.id).filter(Boolean))];
          let shippingMap: Map<string, any[]> = new Map();
          
          if (orderIds.length > 0) {
            try {
              const placeholders = orderIds.map(() => '?').join(',');
              const [shipRows]: any = await connection.execute(`
                SELECT 
                  id, seller_order_id, shipper_id, status as ship_status,
                  assigned_at, shipped_at, delivered_at, notes as ship_notes
                FROM seller_order_shipping
                WHERE seller_order_id IN (${placeholders})
                ORDER BY assigned_at DESC
              `, orderIds);
              
              (shipRows as any[]).forEach((sr: any) => {
                if (!shippingMap.has(sr.seller_order_id)) {
                  shippingMap.set(sr.seller_order_id, []);
                }
                shippingMap.get(sr.seller_order_id)!.push({
                  shippingId: sr.id,
                  shipperId: sr.shipper_id,
                  status: sr.ship_status,
                  assignedAt: sr.assigned_at,
                  shippedAt: sr.shipped_at,
                  deliveredAt: sr.delivered_at,
                  notes: sr.ship_notes
                });
              });
            } catch (e) {
              // table may not exist on this shard yet
            }
          }

          return { shardHost, rows: rows as any[], shippingMap, shipperIds: new Set<string>() };
        } catch (err) {
          console.error(`Order fetch failed on ${shardHost}:`, err);
          return { shardHost, rows: [], shippingMap: new Map() };
        } finally {
          await connection.end();
        }
      });

      const shardResults = await Promise.all(shardQueries);

      const ordersMap = new Map();

      // Collect all unique shipper IDs across all shards for name resolution
      const allShipperIds = new Set<string>();
      
      shardResults.forEach(({ rows, shippingMap }) => {
        rows.forEach((row: any) => {
          if (!ordersMap.has(row.id)) {
            const pincode = row.pincode || '';
            const shippingRecords = shippingMap?.get(row.id) || [];
            // Collect shipper IDs
            shippingRecords.forEach((sr: any) => {
              if (sr.shipperId) allShipperIds.add(sr.shipperId);
            });
            
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
              pincode: pincode,
              products: [],
              shippers: shippingRecords
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

      // Resolve shipper names from global DB (shippers table stays global)
      const shipperNameMap = new Map<string, { shippername: string; phone: string; email: string }>();
      if (allShipperIds.size > 0) {
        try {
          const ids = Array.from(allShipperIds);
          const placeholders = ids.map(() => '?').join(',');
          const [nameRows]: any = await globalPool.execute(
            `SELECT id, shippername, phone, email FROM shippers WHERE id IN (${placeholders})`,
            ids
          );
          (nameRows as any[]).forEach((r: any) => {
            shipperNameMap.set(r.id, { shippername: r.shippername, phone: r.phone, email: r.email });
          });
        } catch (e) {
          console.warn('Failed to resolve shipper names:', e);
        }
      }

      // Merge shipper names into results
      const result = Array.from(ordersMap.values()).map((order: any) => ({
        ...order,
        shippers: order.shippers.map((s: any) => ({
          ...s,
          shipperName: shipperNameMap.get(s.shipperId)?.shippername || 'Unknown',
          shipperPhone: shipperNameMap.get(s.shipperId)?.phone || '',
          shipperEmail: shipperNameMap.get(s.shipperId)?.email || ''
        }))
      })).sort((a: any, b: any) => new Date(b._createdAt).getTime() - new Date(a._createdAt).getTime());

      console.log(`<Fetched ${result.length} orders for seller across ${sellerShards.length} shard(s)>`);
      res.status(200).json(result);
    } catch (err: any) {
      console.error("Error fetching seller orders:", err);
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  }
);

// ---- SHIPPER MANAGEMENT ENDPOINTS ----

// Fetch all registered shippers (for admin to select when assigning)
app.get(
  "/fetch-all-shippers",
  verifyClerkToken,
  async (req: Request, res: Response) => {
    try {
      const [rows] = await globalPool.execute(
        'SELECT id, shippername, phone, email, geo_lat, geo_lng, address_pincode, address_county, address_country, address_state, created_at FROM shippers ORDER BY shippername'
      );
      res.status(200).json(rows);
    } catch (err: any) {
      console.error("Error fetching shippers:", err);
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  }
);

// Assign a shipper to a seller_order (with products to ship)
app.post(
  "/assign-shipper",
  verifyClerkToken,
  async (req: Request, res: Response) => {
    const { sellerOrderId, shipperId, orderId, sellerId, pincode, products, notes } = req.body as {
      sellerOrderId: string;
      shipperId: string;
      orderId: string;
      sellerId: string;
      pincode?: string;
      products: Array<{ productId: string; quantity: number }>;
      notes?: string;
    };

    if (!sellerOrderId || !shipperId || !orderId || !sellerId || !products?.length) {
      res.status(400).json({ error: "Missing required fields: sellerOrderId, shipperId, orderId, sellerId, products" });
      return;
    }

    // Determine target shard from pincode (required for sharded seller_orders)
    const targetPincode = pincode || '';
    const shardHost = targetPincode ? ShardHelper.getShardHost(targetPincode) : null;

    if (!shardHost) {
      res.status(400).json({ error: "pincode is required to route to the correct shard" });
      return;
    }

    const connection = await getShardConnection(shardHost);

    try {
      const { uuidv7 } = await import('uuidv7');
      const shippingId = uuidv7();

      // Insert shipping assignment into the seller's shard
      await connection.execute(
        `INSERT INTO seller_order_shipping (id, seller_order_id, shipper_id, order_id, seller_id, pincode, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, 'assigned', ?)`,
        [shippingId, sellerOrderId, shipperId, orderId, sellerId, targetPincode, notes || null]
      );

      // Insert shipping items (which products are being shipped)
      for (const item of products) {
        await connection.execute(
          `INSERT INTO seller_order_shipping_items (shipping_id, product_id, quantity)
           VALUES (?, ?, ?)`,
          [shippingId, item.productId, item.quantity]
        );
      }

      // Send Kafka notification for real-time SSE update
      const producer = kafka.producer();
      await producer.connect();
      try {
        await producer.send({
          topic: "shipper-assignment-topic",
          messages: [{
            value: JSON.stringify({
              shippingId,
              sellerOrderId,
              shipperId,
              orderId,
              sellerId,
              products,
              status: 'assigned',
              timestamp: new Date().toISOString()
            })
          }]
        });
      } finally {
        await producer.disconnect().catch(() => {});
      }

      res.status(201).json({
        message: "Shipper assigned successfully",
        shippingId
      });
    } catch (err: any) {
      console.error("Error assigning shipper:", err);
      res.status(500).json({ error: "Failed to assign shipper", details: err.message });
    } finally {
      await connection.end();
    }
  }
);

// Get all shipping assignments for a seller (for admin to see shipper activity)
app.get(
  "/seller-order-shippers/:sellerId",
  verifyClerkToken,
  async (req: Request<{ sellerId: string }>, res: Response) => {
    try {
      const { sellerId } = req.params;
      const sellerShards = await ShardHelper.getSellerShards(sellerId);

      // Query each shard for seller_order_shipping
      const shardQueries = sellerShards.map(async (shardHost) => {
        const connection = await getShardConnection(shardHost);
        try {
          const [rows] = await connection.execute(`
            SELECT 
              sos.id, sos.seller_order_id, sos.shipper_id, sos.order_id,
              sos.status as shipping_status,
              sos.assigned_at, sos.picked_up_at, sos.shipped_at, sos.delivered_at,
              sos.notes as shipping_notes,
              so.status as order_status, so.total_amount,
              sos.created_at
            FROM seller_order_shipping sos
            JOIN seller_orders so ON sos.seller_order_id = so.id
            WHERE sos.seller_id = ?
            ORDER BY sos.created_at DESC
          `, [sellerId]);
          return { shardHost, rows: rows as any[] };
        } finally {
          await connection.end();
        }
      });

      const shardResults = await Promise.all(shardQueries);

      // Collect all shipping IDs and shipper IDs
      const allRecords: any[] = [];
      const allShippingIds: string[] = [];
      const allShipperIds = new Set<string>();

      shardResults.forEach(({ rows }) => {
        rows.forEach((r: any) => {
          allRecords.push(r);
          allShippingIds.push(r.id);
          if (r.shipper_id) allShipperIds.add(r.shipper_id);
        });
      });

      // Fetch product names from each shard
      let itemsMap: Map<string, any[]> = new Map();
      if (allShippingIds.length > 0) {
        const shardProductPromises = shardResults.map(async ({ shardHost }) => {
          const connection = await getShardConnection(shardHost);
          try {
            const placeholders = allShippingIds.map(() => '?').join(',');
            const [itemRows]: any = await connection.execute(`
              SELECT sosi.shipping_id, sosi.product_id, sosi.quantity, p.product_name
              FROM seller_order_shipping_items sosi
              LEFT JOIN products p ON sosi.product_id = p.id
              WHERE sosi.shipping_id IN (${placeholders})
            `, allShippingIds);
            return itemRows as any[];
          } finally {
            await connection.end();
          }
        });
        const productResults = await Promise.all(shardProductPromises);
        productResults.forEach((itemRows) => {
          itemRows.forEach((item: any) => {
            if (!itemsMap.has(item.shipping_id)) itemsMap.set(item.shipping_id, []);
            itemsMap.get(item.shipping_id)!.push({
              productId: item.product_id,
              productName: item.product_name || 'Unknown',
              quantity: item.quantity
            });
          });
        });
      }

      // Resolve shipper names from global DB
      const shipperNameMap = new Map<string, { shippername: string; phone: string; email: string }>();
      if (allShipperIds.size > 0) {
        const ids = Array.from(allShipperIds);
        const placeholders = ids.map(() => '?').join(',');
        const [nameRows]: any = await globalPool.execute(
          `SELECT id, shippername, phone, email FROM shippers WHERE id IN (${placeholders})`,
          ids
        );
        (nameRows as any[]).forEach((r: any) => {
          shipperNameMap.set(r.id, { shippername: r.shippername, phone: r.phone, email: r.email });
        });
      }

      const result = allRecords.map(record => ({
        ...record,
        shippername: shipperNameMap.get(record.shipper_id)?.shippername || 'Unknown',
        shipper_phone: shipperNameMap.get(record.shipper_id)?.phone || '',
        shipper_email: shipperNameMap.get(record.shipper_id)?.email || '',
        products: itemsMap.get(record.id) || []
      }));

      res.status(200).json(result);
    } catch (err: any) {
      console.error("Error fetching seller order shippers:", err);
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  }
);

// Get detailed shipment history for a specific shipper (fraud tracing)
// Shows which dates this shipper shipped which products from which sellers
app.get(
  "/shipper-shipment-details/:shipperId",
  verifyClerkToken,
  async (req: Request<{ shipperId: string }>, res: Response) => {
    try {
      const { shipperId } = req.params;

      // Get shipper info from global DB (shippers table stays global)
      const [shipperRows] = await globalPool.execute(
        'SELECT id, shippername, phone, email, address_pincode, address_county, address_state, address_country, created_at FROM shippers WHERE id = ?',
        [shipperId]
      );

      if (!Array.isArray(shipperRows) || shipperRows.length === 0) {
        res.status(404).json({ error: "Shipper not found" });
        return;
      }

      const shipperInfo = (shipperRows as any[])[0];

      // Query ALL shards for this shipper's assignments
      const allShardPromises = SHARD_HOSTS.map(async (shardHost) => {
        const connection = await getShardConnection(shardHost);
        try {
          const [shipRows] = await connection.execute(`
            SELECT 
              sos.id, sos.seller_order_id, sos.order_id, sos.seller_id, sos.pincode,
              sos.status as shipping_status,
              sos.assigned_at, sos.picked_up_at, sos.shipped_at, sos.delivered_at,
              sos.notes as shipping_notes,
              so.status as order_status, so.total_amount
            FROM seller_order_shipping sos
            JOIN seller_orders so ON sos.seller_order_id = so.id
            WHERE sos.shipper_id = ?
            ORDER BY sos.assigned_at DESC
          `, [shipperId]);

          // Get product names for these shipments from the same shard
          const shippingIds = (shipRows as any[]).map(r => r.id).filter(Boolean);
          let itemsMap = new Map<string, any[]>();
          
          if (shippingIds.length > 0) {
            const placeholders = shippingIds.map(() => '?').join(',');
            const [itemRows]: any = await connection.execute(`
              SELECT sosi.shipping_id, sosi.product_id, sosi.quantity, p.product_name, p.price_amount
              FROM seller_order_shipping_items sosi
              LEFT JOIN products p ON sosi.product_id = p.id
              WHERE sosi.shipping_id IN (${placeholders})
            `, shippingIds);
            
            (itemRows as any[]).forEach((item: any) => {
              if (!itemsMap.has(item.shipping_id)) itemsMap.set(item.shipping_id, []);
              itemsMap.get(item.shipping_id)!.push({
                productId: item.product_id,
                productName: item.product_name || 'Unknown',
                quantity: item.quantity,
                price: item.price_amount || 0
              });
            });
          }

          return { shardHost, rows: shipRows as any[], itemsMap };
        } finally {
          await connection.end();
        }
      });

      const shardResults = await Promise.all(allShardPromises);

      // Collect all unique seller IDs for name resolution
      const allSellerIds = new Set<string>();
      const shipments: any[] = [];

      shardResults.forEach(({ rows, itemsMap }) => {
        rows.forEach((record: any) => {
          if (record.seller_id) allSellerIds.add(record.seller_id);
          shipments.push({
            shippingId: record.id,
            sellerOrderId: record.seller_order_id,
            orderId: record.order_id,
            sellerId: record.seller_id,
            pincode: record.pincode,
            status: record.shipping_status,
            orderStatus: record.order_status,
            totalAmount: record.total_amount,
            assignedAt: record.assigned_at,
            pickedUpAt: record.picked_up_at,
            shippedAt: record.shipped_at,
            deliveredAt: record.delivered_at,
            notes: record.shipping_notes,
            products: itemsMap?.get(record.id) || []
          });
        });
      });

      // Resolve seller names from global DB
      const sellerNameMap = new Map<string, string>();
      if (allSellerIds.size > 0) {
        const ids = Array.from(allSellerIds);
        const placeholders = ids.map(() => '?').join(',');
        const [nameRows]: any = await globalPool.execute(
          `SELECT id, username, email FROM sellers WHERE id IN (${placeholders})`,
          ids
        );
        (nameRows as any[]).forEach((r: any) => {
          sellerNameMap.set(r.id, r.username);
        });
      }

      // Sort by assignedAt descending and enrich with seller names
      shipments.sort((a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime());
      shipments.forEach(s => {
        s.sellerName = sellerNameMap.get(s.sellerId) || 'Unknown';
      });

      res.status(200).json({
        shipper: {
          id: shipperInfo.id,
          name: shipperInfo.shippername,
          phone: shipperInfo.phone,
          email: shipperInfo.email,
          address: {
            pincode: shipperInfo.address_pincode,
            county: shipperInfo.address_county,
            state: shipperInfo.address_state,
            country: shipperInfo.address_country
          }
        },
        totalShipments: shipments.length,
        shipments
      });
    } catch (err: any) {
      console.error("Error fetching shipper shipment details:", err);
      res.status(500).json({ error: "Internal server error", details: err.message });
    }
  }
);

// Update shipping status (shipped, delivered, etc.)
app.patch(
  "/update-shipping-status/:shippingId",
  verifyClerkToken,
  async (req: Request<{ shippingId: string }>, res: Response) => {
    try {
      const { shippingId } = req.params;
      const { status, notes, pincode } = req.body as { status: string; notes?: string; pincode?: string };

      const validStatuses = ['assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled'];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        return;
      }

      let targetShard: string | null = null;

      // If pincode is provided, route directly to that shard
      if (pincode) {
        targetShard = ShardHelper.getShardHost(pincode);
      } else {
        // Otherwise, iterate shards to find the record
        for (const shardHost of SHARD_HOSTS) {
          const conn = await getShardConnection(shardHost);
          try {
            const [rows]: any = await conn.execute(
              'SELECT id FROM seller_order_shipping WHERE id = ? LIMIT 1',
              [shippingId]
            );
            if ((rows as any[]).length > 0) {
              targetShard = shardHost;
              break;
            }
          } finally {
            await conn.end();
          }
        }
      }

      if (!targetShard) {
        res.status(404).json({ error: "Shipping record not found" });
        return;
      }

      const connection = await getShardConnection(targetShard);
      try {
        const updateFields: string[] = ['status = ?'];
        const updateValues: any[] = [status];

        if (status === 'picked_up') {
          updateFields.push('picked_up_at = NOW()');
        } else if (status === 'delivered') {
          updateFields.push('delivered_at = NOW()');
        }

        if (notes) {
          updateFields.push('notes = ?');
          updateValues.push(notes);
        }

        updateValues.push(shippingId);

        await connection.execute(
          `UPDATE seller_order_shipping SET ${updateFields.join(', ')} WHERE id = ?`,
          updateValues
        );

        // Send Kafka notification
        const producer = kafka.producer();
        await producer.connect();
        try {
          await producer.send({
            topic: "shipping-event-topic",
            messages: [{
              value: JSON.stringify({
                shippingId,
                status,
                timestamp: new Date().toISOString()
              })
            }]
          });
        } finally {
          await producer.disconnect().catch(() => {});
        }

        res.status(200).json({ message: `Shipping status updated to ${status}` });
      } finally {
        await connection.end();
      }
    } catch (err: any) {
      console.error("Error updating shipping status:", err);
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