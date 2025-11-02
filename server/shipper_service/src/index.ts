import cluster from "cluster";
import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { availableParallelism } from "os";
import { createClient, SanityClient } from '@sanity/client'
import { createClient as RedisClient } from "redis";
import { sanityConfig } from './utils/index.js';
import { Kafka, logLevel, Producer, RecordMetadata } from "kafkajs";
import { verifyToken } from "@clerk/backend";
import { spawn } from 'node:child_process'
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
    let old_child_process: any[] = []
    setInterval(() => {
        const child_process = spawn('curl.exe', [
            '-X',
            'GET',
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
    const kafka = new Kafka({
        clientId: "xv store",
        brokers: ["localhost:9095", "localhost:9096", "localhost:9097"],
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

    //fetch user orders for shipper
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

                // Fetch from Sanity if not in cache
                const order = await sanityClient.fetch(
                    `*[_type=='order' && orderId==$orderId][0]{
            _id,
            orderId,
            customer->{
              _id,
              username,
              email,
              phone,
              geoPoint,
              address
            },
            product,
            quantity,
            transactionId,
            paymentSignature,
            amount,
            status,
            createdAt,
            expectedDelivery
          }`,
                    { orderId }
                );

                if (!order) {
                    res.status(404).json({ error: 'Order not found' });
                    return;
                }

                // Cache the order in Redis
                if (redisClient.isOpen) {
                    await redisClient.hSet("hashSet:orders", orderId, JSON.stringify(order));
                    await redisClient.sAdd("set:order:ids", orderId);
                }

                res.status(200).json(order);
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

                // Fetch from Sanity
                const orders = await sanityClient.fetch(
                    `*[_type=='order' && shipperId==$shipperId && status in ['shipping', 'dispatched']]{
            _id,
            orderId,
            customer->{
              _id,
              username,
              email,
              phone,
              geoPoint,
              address
            },
            product,
            quantity,
            transactionId,
            amount,
            status,
            createdAt,
            expectedDelivery
          } | order(createdAt desc)`,
                    { shipperId }
                );

                res.status(200).json(orders);
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
            try {
                const { orderId, status } = req.body;
                console.log(`<Updating order ${orderId} to status: ${status}>`);

                // Send update to Kafka
                const producer: Producer = kafka.producer({
                    allowAutoTopicCreation: false,
                    transactionTimeout: 60000,
                });

                await producer.connect();

                const recordMetaData: RecordMetadata[] = await producer.send({
                    topic: "order-status-update-topic",
                    messages: [{ value: JSON.stringify({ orderId, status, updatedAt: new Date().toISOString() }) }],
                });

                producer.on("producer.network.request_timeout", (ev) => {
                    res.status(503).json({ error: "Session timeout! Couldn't update order status." });
                });

                // Invalidate Redis cache
                if (redisClient.isOpen) {
                    await redisClient.hDel("hashSet:orders", orderId);
                }

                res.status(200).json({ message: 'Order status will be updated soon!' });
                await producer.disconnect();
            } catch (e: Error | any) {
                console.error('Error updating order status:', e);
                res.status(500).json({ error: e.message });
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