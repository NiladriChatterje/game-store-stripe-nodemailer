import cluster from "cluster";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { availableParallelism } from "os";
import mysql from 'mysql2/promise';
import { createClient as RedisClient } from "redis";
import { GLOBAL_DB_CONFIG } from './utils/index.js';
import { Kafka, logLevel, Producer, RecordMetadata } from "kafkajs";
import { verifyToken } from "@clerk/backend";
import { JwtPayload } from "@clerk/types";


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
    // Limit workers to prevent OOM
    const numWorkers = Math.min(availableParallelism(), 4);

    let p;
    for (let i = 0; i < numWorkers; i++) {
        p = cluster.fork();

        p.on("exit", (_statusCode: number) => {
            p = cluster.fork();
        });
    }
} else {
    const kafka = new Kafka({
        clientId: "xv store",
        brokers: ["kafka1:9092", "kafka2:9093", "kafka3:9094"],
        retry: {
            retries: 2,
        },
        logLevel: logLevel.ERROR,
    });

    const app: Express = express();

    // MySQL Global DB Pool
    const globalPool = mysql.createPool({
        ...GLOBAL_DB_CONFIG,
        waitForConnections: true,
        connectionLimit: 2,
        queueLimit: 10
    });

    const redisClient = RedisClient({
        url: 'redis://redis_storage:6379'
    });

    try {
        await redisClient.connect();
        console.log("<Redis connected successfully>");
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
    const verifyClerkToken = async (req: Request, res: Response, next: NextFunction) => {
        try {
            // Get token from Authorization header
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


    //#region ENDPOINTS
    //ping self to keep server awake
    app.get("/", (req: Request, res: Response) => {
        res.end("Shipper service is running!");
    });

    //fetch user order by orderId
    app.get(
        "/fetch-user-order/:orderId",
        verifyClerkToken,
        async (req: Request<{ orderId: string }>, res: Response) => {
            try {
                const { orderId } = req.params;
                console.log(`<Fetching order: ${orderId}>`);

                // Try to fetch from Redis cache first
                if (redisClient.isOpen) {
                    const cachedOrder = await redisClient.hGet("hashSet:orders", orderId);
                    if (cachedOrder) {
                        console.log("<Redis order hit>");
                        res.json(JSON.parse(cachedOrder));
                        return;
                    }
                }

                // Fetch from MySQL global DB
                const [orderRows] = await globalPool.execute(
                    `SELECT 
                        o.id,
                        o.order_id_display AS orderId,
                        o.customer_id,
                        o.shipper_id,
                        o.quantity,
                        o.transaction_id AS transactionId,
                        o.payment_signature AS paymentSignature,
                        o.amount,
                        o.status,
                        o.created_at AS createdAt,
                        o.updated_at AS updatedAt
                     FROM orders o
                     WHERE o.order_id_display = ?`,
                    [orderId]
                );

                const order = (orderRows as any[])[0];
                if (!order) {
                    res.status(404).json({ error: 'Order not found' });
                    return;
                }

                // Fetch customer info from users table
                const [userRows] = await globalPool.execute(
                    `SELECT id, username, email, phone, geo_lat, geo_lng,
                            address_pincode, address_county, address_country, address_state
                     FROM users WHERE id = ?`,
                    [order.customer_id]
                );
                const customer = (userRows as any[])[0] || null;

                // Build response matching the old Sanity shape
                const result = {
                    _id: order.id,
                    orderId: order.orderId,
                    customer: customer ? {
                        _id: customer.id,
                        username: customer.username,
                        email: customer.email,
                        phone: customer.phone,
                        geoPoint: customer.geo_lat && customer.geo_lng
                            ? { lat: customer.geo_lat, lng: customer.geo_lng }
                            : null,
                        address: customer.address_pincode
                            ? {
                                pincode: customer.address_pincode,
                                county: customer.address_county,
                                country: customer.address_country,
                                state: customer.address_state
                              }
                            : null
                    } : null,
                    product: null, // product info not stored in orders table directly
                    quantity: order.quantity,
                    transactionId: order.transactionId,
                    paymentSignature: order.paymentSignature,
                    amount: order.amount,
                    status: order.status,
                    createdAt: order.createdAt,
                    expectedDelivery: null // no expected_delivery in orders table
                };

                // Cache the order in Redis
                if (redisClient.isOpen) {
                    await redisClient.hSet("hashSet:orders", orderId, JSON.stringify(result));
                    await redisClient.sAdd("set:order:ids", orderId);
                }

                res.status(200).json(result);
            } catch (e: Error | any) {
                console.error('Error fetching order:', e);
                res.status(500).json({ error: e.message });
            }
        }
    );

    //fetch all orders assigned to shipper
    app.get(
        "/fetch-shipper-orders/:shipperId",
        verifyClerkToken,
        async (req: Request<{ shipperId: string }>, res: Response) => {
            try {
                const { shipperId } = req.params;
                console.log(`<Fetching orders for shipper: ${shipperId}>`);

                // Fetch from MySQL global DB — orders with status 'shipping' or 'dispatched' for this shipper
                const [orderRows] = await globalPool.execute(
                    `SELECT 
                        o.id,
                        o.order_id_display AS orderId,
                        o.customer_id,
                        o.shipper_id,
                        o.quantity,
                        o.transaction_id AS transactionId,
                        o.payment_signature AS paymentSignature,
                        o.amount,
                        o.status,
                        o.created_at AS createdAt,
                        o.updated_at AS updatedAt
                     FROM orders o
                     WHERE o.shipper_id = ?
                       AND o.status IN ('shipping', 'dispatched')
                     ORDER BY o.created_at DESC`,
                    [shipperId]
                );

                const orders = orderRows as any[];

                // Fetch customer info for all orders (batch)
                const customerIds = [...new Set(orders.map(o => o.customer_id).filter(Boolean))];
                let customerMap: Record<string, any> = {};
                if (customerIds.length > 0) {
                    const placeholders = customerIds.map(() => '?').join(',');
                    const [userRows] = await globalPool.execute(
                        `SELECT id, username, email, phone, geo_lat, geo_lng,
                                address_pincode, address_county, address_country, address_state
                         FROM users WHERE id IN (${placeholders})`,
                        customerIds
                    );
                    for (const user of (userRows as any[])) {
                        customerMap[user.id] = user;
                    }
                }

                const result = orders.map(order => {
                    const customer = customerMap[order.customer_id] || null;
                    return {
                        _id: order.id,
                        orderId: order.orderId,
                        customer: customer ? {
                            _id: customer.id,
                            username: customer.username,
                            email: customer.email,
                            phone: customer.phone,
                            geoPoint: customer.geo_lat && customer.geo_lng
                                ? { lat: customer.geo_lat, lng: customer.geo_lng }
                                : null,
                            address: customer.address_pincode
                                ? {
                                    pincode: customer.address_pincode,
                                    county: customer.address_county,
                                    country: customer.address_country,
                                    state: customer.address_state
                                  }
                                : null
                        } : null,
                        product: null,
                        quantity: order.quantity,
                        transactionId: order.transactionId,
                        amount: order.amount,
                        status: order.status,
                        createdAt: order.createdAt,
                        expectedDelivery: null
                    };
                });

                res.status(200).json(result);
            } catch (e: Error | any) {
                console.error('Error fetching shipper orders:', e);
                res.status(500).json({ error: e.message });
            }
        }
    );

    //update order status
    app.patch(
        "/update-order-status",
        verifyClerkToken,
        async (req: Request<{}, {}, { orderId: string; status: string }>, res: Response) => {
            const producer: Producer = kafka.producer({
                allowAutoTopicCreation: false,
                transactionTimeout: 60000,
            });
            try {
                const { orderId, status } = req.body;
                console.log(`<Updating order ${orderId} to status: ${status}>`);

                // Send update to Kafka
                await producer.connect();

                await producer.send({
                    topic: "order-status-update-topic",
                    messages: [{ value: JSON.stringify({ orderId, status, updatedAt: new Date().toISOString() }) }],
                });

                // Invalidate Redis cache
                if (redisClient.isOpen) {
                    await redisClient.hDel("hashSet:orders", orderId);
                }

                res.status(200).json({ message: 'Order status will be updated soon!' });
            } catch (e: Error | any) {
                console.error('Error updating order status:', e);
                res.status(500).json({ error: e.message });
            } finally {
                await producer.disconnect().catch(() => {});
            }
        }
    );

    //update shipper location
    app.post(
        "/update-shipper-location",
        verifyClerkToken,
        async (req: Request<{}, {}, { shipperId: string; location: { lat: number; lng: number } }>, res: Response) => {
            try {
                const { shipperId, location } = req.body;
                console.log(`<Updating shipper ${shipperId} location:`, location, '>')

                // Store location in Redis with expiry
                if (redisClient.isOpen) {
                    await redisClient.hSet(
                        "hashSet:shipper:locations",
                        shipperId,
                        JSON.stringify({ ...location, timestamp: new Date().toISOString() })
                    );
                    // Set expiry for 1 hour
                    await redisClient.expire("hashSet:shipper:locations", 3600);
                }

                res.status(200).json({ message: 'Location updated successfully' });
            } catch (e: Error | any) {
                console.error('Error updating shipper location:', e);
                res.status(500).json({ error: e.message });
            }
        }
    );

    //get shipper location
    app.get(
        "/get-shipper-location/:shipperId",
        verifyClerkToken,
        async (req: Request<{ shipperId: string }>, res: Response) => {
            try {
                const { shipperId } = req.params;

                if (redisClient.isOpen) {
                    const location = await redisClient.hGet("hashSet:shipper:locations", shipperId);
                    if (location) {
                        res.json(JSON.parse(location));
                        return;
                    }
                }

                res.status(404).json({ error: 'Location not found' });
            } catch (e: Error | any) {
                console.error('Error fetching shipper location:', e);
                res.status(500).json({ error: e.message });
            }
        }
    );

    //#endregion 


    app.listen(process.env.PORT ?? 5004, () =>
        console.log("Shipper service listening on PORT:" + (process.env.PORT ?? 5004))
    );
}