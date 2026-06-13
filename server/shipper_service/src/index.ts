import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import mysql from 'mysql2/promise';
import { createClient as RedisClient } from "redis";
import { GLOBAL_DB_CONFIG } from './utils/index.js';
import { Kafka, logLevel, Producer, RecordMetadata } from "kafkajs";
import { verifyToken } from "@clerk/backend";
import { JwtPayload } from "@clerk/types";

// ============================================================================
// SHARD CONFIGURATION (mirrors seller_service for seller_order_shipping writes)
// ============================================================================
const SHARD_HOSTS = ['mysql1', 'mysql2', 'mysql3', 'mysql4', 'mysql5'];

async function getShardConnection(shardHost: string): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: shardHost,
    port: 3306,
    user: 'root',
    database: 'xvstore'
  });
}


dotenv.config();

//#region custom express.Request definition
declare module "express-serve-static-core" {
    interface Request {
        auth: NonNullable<JwtPayload | undefined>;
        userId: string;
    }
}
//#endregion

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

    //fetch delivered orders for shipper
    app.get(
        "/fetch-delivered-orders/:shipperId",
        verifyClerkToken,
        async (req: Request<{ shipperId: string }>, res: Response) => {
            try {
                const { shipperId } = req.params;
                console.log(`<Fetching delivered orders for shipper: ${shipperId}>`);

                // Fetch orders with status 'shipped' for this shipper
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
                       AND o.status IN ('shipped')
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
                console.error('Error fetching delivered orders:', e);
                res.status(500).json({ error: e.message });
            }
        }
    );

    //#region SHIPPER NOTIFICATION ENDPOINTS

    // GET /shipper/notifications/:shipperId — list notifications
    app.get(
        "/shipper/notifications/:shipperId",
        verifyClerkToken,
        async (req: Request<{ shipperId: string }>, res: Response) => {
            try {
                const { shipperId } = req.params;
                const statusFilter = req.query.status as string | undefined;
                console.log(`<Fetching notifications for shipper: ${shipperId}>`);

                let notifications: any[] = [];

                // Try Redis first (freshest data)
                if (redisClient.isOpen) {
                    const redisKey = `shipper:notifications:${shipperId}`;
                    const raw = await redisClient.lRange(redisKey, 0, -1);
                    if (raw.length > 0) {
                        notifications = raw.map((item: string) => JSON.parse(item));
                    }
                }

                // Fallback: fetch from MySQL if Redis is empty or unavailable
                if (notifications.length === 0) {
                    let query = `SELECT id, shipper_id, type, seller_order_id, order_id, seller_id,
                                        pincode, amount, payload, read_status, claim_status, claimed_at, created_at
                                 FROM shipper_notifications
                                 WHERE shipper_id = ?`;
                    const params: any[] = [shipperId];

                    if (statusFilter) {
                        query += ` AND read_status = ?`;
                        params.push(statusFilter);
                    }

                    query += ` ORDER BY created_at DESC LIMIT 50`;

                    const [rows] = await globalPool.execute(query, params);
                    notifications = (rows as any[]).map((row: any) => ({
                        id: row.id,
                        type: row.type,
                        sellerOrderId: row.seller_order_id,
                        orderId: row.order_id,
                        sellerId: row.seller_id,
                        pincode: row.pincode,
                        amount: Number(row.amount),
                        ...(row.payload ? JSON.parse(row.payload) : {}),
                        readStatus: row.read_status,
                        claimStatus: row.claim_status,
                        claimedAt: row.claimed_at,
                        createdAt: row.created_at
                    }));
                } else if (statusFilter) {
                    notifications = notifications.filter((n: any) => n.readStatus === statusFilter || n.read_status === statusFilter);
                }

                res.status(200).json(notifications);
            } catch (e: Error | any) {
                console.error('Error fetching notifications:', e);
                res.status(500).json({ error: e.message });
            }
        }
    );

    // POST /shipper/notifications/:notificationId/read — mark notification as read
    app.post(
        "/shipper/notifications/:notificationId/read",
        verifyClerkToken,
        async (req: Request<{ notificationId: string }>, res: Response) => {
            try {
                const { notificationId } = req.params;
                const { shipperId } = req.body as { shipperId: string };

                // Update MySQL
                await globalPool.execute(
                    `UPDATE shipper_notifications SET read_status = 'read' WHERE id = ? AND shipper_id = ?`,
                    [notificationId, shipperId]
                );

                // Update Redis: find and update the notification in the list
                if (redisClient.isOpen && shipperId) {
                    const redisKey = `shipper:notifications:${shipperId}`;
                    const raw = await redisClient.lRange(redisKey, 0, -1);
                    for (const item of raw) {
                        try {
                            const parsed = JSON.parse(item);
                            if (parsed.id === notificationId) {
                                parsed.readStatus = 'read';
                                await redisClient.lRem(redisKey, 1, item);
                                await redisClient.lPush(redisKey, JSON.stringify(parsed));
                                break;
                            }
                        } catch {}
                    }
                }

                res.status(200).json({ message: 'Notification marked as read' });
            } catch (e: Error | any) {
                console.error('Error marking notification as read:', e);
                res.status(500).json({ error: e.message });
            }
        }
    );

    // GET /shipper/unread-count/:shipperId — unread count for badge
    app.get(
        "/shipper/unread-count/:shipperId",
        verifyClerkToken,
        async (req: Request<{ shipperId: string }>, res: Response) => {
            try {
                const { shipperId } = req.params;

                // Try Redis first
                if (redisClient.isOpen) {
                    const redisKey = `shipper:notifications:${shipperId}`;
                    const raw = await redisClient.lRange(redisKey, 0, -1);
                    if (raw.length > 0) {
                        const parsed = raw.map((item: string) => JSON.parse(item));
                        const unread = parsed.filter((n: any) => n.readStatus === 'unread' || n.read_status === 'unread');
                        res.status(200).json({ count: unread.length });
                        return;
                    }
                }

                // Fallback to MySQL
                const [rows] = await globalPool.execute(
                    `SELECT COUNT(*) as count FROM shipper_notifications
                     WHERE shipper_id = ? AND read_status = 'unread'`,
                    [shipperId]
                );
                const count = Number((rows as any[])[0]?.count || 0);
                res.status(200).json({ count });
            } catch (e: Error | any) {
                console.error('Error fetching unread count:', e);
                res.status(500).json({ error: e.message });
            }
        }
    );

    // POST /shipper/accept-delivery — claim a delivery with Redis SETNX lock
    app.post(
        "/shipper/accept-delivery",
        verifyClerkToken,
        async (req: Request, res: Response) => {
            const { shipperId, sellerOrderId, sellerId, orderId, pincode, products } = req.body as {
                shipperId: string;
                sellerOrderId: string;
                sellerId: string;
                orderId: string;
                pincode: string;
                products: Array<{ productId: string; quantity: number; productName?: string }>;
            };

            if (!shipperId || !sellerOrderId || !sellerId || !orderId || !pincode || !products?.length) {
                res.status(400).json({ error: "Missing required fields" });
                return;
            }

            try {
                // 1. Redis SETNX distributed lock (atomic claim)
                const lockKey = `delivery:claim:${sellerOrderId}`;
                const lockValue = JSON.stringify({ shipperId, claimedAt: new Date().toISOString() });

                let lockAcquired = false;

                if (redisClient.isOpen) {
                    const result = await redisClient.setNX(lockKey, lockValue);
                    if (result === true) {
                        await redisClient.expire(lockKey, 3600); // 1 hour TTL
                        lockAcquired = true;
                    }
                } else {
                    // Fallback: MySQL advisory lock via INSERT ... ON DUPLICATE KEY
                    try {
                        await globalPool.execute(
                            `INSERT INTO shipper_notifications (id, shipper_id, type, seller_order_id, order_id, seller_id, pincode, amount, payload, claim_status, claimed_at)
                             VALUES (?, ?, 'new_delivery', ?, ?, ?, ?, 0, '{}', 'accepted', NOW())`,
                            [`claim:${sellerOrderId}`, shipperId, sellerOrderId, orderId, sellerId, pincode]
                        );
                        lockAcquired = true;
                    } catch (insertErr: any) {
                        if (insertErr.code === 'ER_DUP_ENTRY') {
                            lockAcquired = false;
                        } else {
                            throw insertErr;
                        }
                    }
                }

                if (!lockAcquired) {
                    // Someone else claimed it
                    console.log(`[accept-delivery] Lock failed for ${sellerOrderId} — already claimed`);

                    // Try to get who claimed it
                    let claimedBy = null;
                    if (redisClient.isOpen) {
                        const existingLock = await redisClient.get(lockKey);
                        if (existingLock) {
                            try { claimedBy = JSON.parse(existingLock).shipperId; } catch {}
                        }
                    }

                    res.status(409).json({
                        error: "Already assigned",
                        message: "This delivery has already been claimed by another shipper",
                        claimedBy
                    });
                    return;
                }

                console.log(`[accept-delivery] Lock acquired for ${sellerOrderId} by ${shipperId}`);

                // 2. Call seller_service /assign-shipper via internal HTTP
                // Use Docker service name since we're inside the container network
                const assignResponse = await fetch(`http://seller_service:5003/assign-shipper`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': req.headers.authorization || ''
                    },
                    body: JSON.stringify({
                        sellerOrderId,
                        shipperId,
                        orderId,
                        sellerId,
                        pincode,
                        products: products.map(p => ({ productId: p.productId, quantity: p.quantity })),
                        notes: `Auto-assigned via delivery claim by shipper ${shipperId}`
                    })
                });

                if (!assignResponse.ok) {
                    const assignError = await assignResponse.text();
                    console.error(`[accept-delivery] /assign-shipper failed: ${assignError}`);

                    // Release the lock since the assignment failed
                    if (redisClient.isOpen) {
                        await redisClient.del(lockKey);
                    }

                    res.status(502).json({
                        error: "Failed to assign shipper",
                        details: assignError
                    });
                    return;
                }

                const assignResult = await assignResponse.json();

                // 3. Update notification statuses in MySQL for THIS shipper
                await globalPool.execute(
                    `UPDATE shipper_notifications
                     SET claim_status = 'accepted', read_status = 'claimed', claimed_at = NOW()
                     WHERE seller_order_id = ? AND shipper_id = ?`,
                    [sellerOrderId, shipperId]
                );

                // Mark all OTHER shippers' notifications as rejected
                await globalPool.execute(
                    `UPDATE shipper_notifications
                     SET claim_status = 'rejected_by_other', read_status = 'expired'
                     WHERE seller_order_id = ? AND shipper_id != ? AND claim_status = 'pending'`,
                    [sellerOrderId, shipperId]
                );

                // 4. Update Redis for this shipper
                if (redisClient.isOpen) {
                    const redisKey = `shipper:notifications:${shipperId}`;
                    const raw = await redisClient.lRange(redisKey, 0, -1);
                    for (const item of raw) {
                        try {
                            const parsed = JSON.parse(item);
                            if (parsed.sellerOrderId === sellerOrderId) {
                                parsed.claimed = true;
                                parsed.claimedBy = shipperId;
                                parsed.readStatus = 'claimed';
                                await redisClient.lRem(redisKey, 1, item);
                                await redisClient.lPush(redisKey, JSON.stringify(parsed));
                                break;
                            }
                        } catch {}
                    }
                }

                // 5. Publish claim result to SSE topic for real-time UI updates
                const producer = kafka.producer();
                await producer.connect();
                try {
                    await producer.send({
                        topic: "shipper-claim-response-topic",
                        messages: [{
                            value: JSON.stringify({
                                sellerOrderId,
                                shipperId,
                                claimed: true,
                                shippingId: assignResult.shippingId,
                                timestamp: new Date().toISOString()
                            })
                        }]
                    });
                } finally {
                    await producer.disconnect().catch(() => {});
                }

                res.status(200).json({
                    message: "Delivery claimed and assigned successfully",
                    shippingId: assignResult.shippingId
                });
            } catch (e: Error | any) {
                console.error('[accept-delivery] Error:', e);
                res.status(500).json({ error: "Failed to claim delivery", details: e.message });
            }
        }
    );

    //#endregion

    //fetch dashboard stats for shipper
    app.get(
        "/shipper-dashboard-stats/:shipperId",
        verifyClerkToken,
        async (req: Request<{ shipperId: string }>, res: Response) => {
            try {
                const { shipperId } = req.params;
                console.log(`<Fetching dashboard stats for shipper: ${shipperId}>`);

                // Count orders by status for this shipper
                const [rows] = await globalPool.execute(
                    `SELECT 
                        SUM(CASE WHEN status = 'orderPlaced' THEN 1 ELSE 0 END) AS pending,
                        SUM(CASE WHEN status IN ('dispatched', 'shipping') THEN 1 ELSE 0 END) AS inTransit,
                        SUM(CASE WHEN status = 'shipped' THEN 1 ELSE 0 END) AS delivered
                     FROM orders
                     WHERE shipper_id = ?`,
                    [shipperId]
                );

                const stats = (rows as any[])[0];
                res.status(200).json({
                    pending: Number(stats?.pending || 0),
                    inTransit: Number(stats?.inTransit || 0),
                    delivered: Number(stats?.delivered || 0)
                });
            } catch (e: Error | any) {
                console.error('Error fetching dashboard stats:', e);
                res.status(500).json({ error: e.message });
            }
        }
    );

    //#endregion 


app.listen(process.env.PORT ?? 5004, () =>
    console.log("Shipper service listening on PORT:" + (process.env.PORT ?? 5004))
);
