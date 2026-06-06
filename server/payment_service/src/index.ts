import cluster from 'cluster'
import express, { Express, NextFunction, Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { availableParallelism } from 'os'
import { Kafka, Producer } from 'kafkajs'
import { type Subscription } from '@declaration/index'
import { verifyToken } from '@clerk/backend'
import nodemailer from 'nodemailer';
import Razorpay from 'razorpay'
import shortid from 'shortid'
import { JwtPayload } from '@clerk/types'
dotenv.config()

declare global {
    namespace Express {
        interface Request {
            auth: NonNullable<JwtPayload | undefined>
        }
    }
}

if (cluster.isPrimary) {
    // Limit cluster forks to prevent OOM on resource-constrained systems
    const numWorkers = Math.min(availableParallelism(), 4);

    for (let i = 0; i < numWorkers; i++) {
        let p = cluster.fork()
        p.on('exit', (_statusCode: number) => {
            p = cluster.fork()
        })
    }
} else {
    const app: Express = express();
    const kafka = new Kafka({
        clientId: 'xv-store',
        brokers: ['kafka1:9092', 'kafka2:9093', 'kafka3:9094']
    })

    const transport = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.AUTH_EMAIL,
            pass: process.env.APP_KEY,
        },
    });

    // Reuse a single transport instance; no need to destructure sendMail
    const sendMailAsync = transport.sendMail.bind(transport);

    const verifyClerkToken = async (req: Request<{}, {}, any>, res: Response, next: NextFunction) => {
        try {
            // Get token from Authorization header
            const token = req.headers.authorization?.split(' ')[1];
            if (!token) {
                res.status(401).json({ error: 'No token provided' });
                return;
            }
            // Verify the token
            const payload = await verifyToken(token, {
                secretKey: process.env.CLERK_SECRET_KEY,
                clockSkewInMs: 300000 // Increased to 5 minutes to handle clock skew issues
            });
            // Add user info to request object
            req.auth = payload;
            next();
        } catch (error) {
            console.error('Token verification failed:', error);
            res.status(403).json({ error: 'Invalid token' });
            return;
        }
    };

    app.use(cors())
    app.use(express.json({ limit: '25mb' }))
    app.use(express.urlencoded({ extended: true, limit: '25mb' }))
    app.use((req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        next()
    })

    app.get('/', (req: Request, res: Response) => {
        res.end('pinged!')
    })

    app.post('/razorpay',
        verifyClerkToken,
        async (req: Request, res: Response) => {
            const { price, currency } = req.body
            console.log(price)
            console.log(req.body)
            try {

                const razorpay = new Razorpay({
                    key_id: process.env.RAZORPAY_PUBLIC_KEY || '',
                    key_secret: process.env.RAZORPAY_SECRET_KEY
                });
                const response = await razorpay.orders.create({
                    amount: Number(price),
                    currency,
                    receipt: shortid(),
                    first_payment_min_amount: 2000
                });
                res.json({ ...response, status: 200 })
            } catch (e: Error | any) {
                res.json({
                    status: 500,
                    error: {
                        message: e?.message,
                    },
                });
            }

        })


    app.post('/seller-subscription',
        verifyClerkToken,
        async (req: Request<{}, {}, { _id: string, subscriptionPlan: Subscription }>, res: Response) => {
            const producer: Producer = kafka.producer();
            try {
                const { _id, subscriptionPlan } = req.body;
                await producer.connect();
                await producer.send(
                    {
                        topic: 'admin-subscriptions-topic',
                        messages: [{ value: JSON.stringify({ _id, subscriptionPlan }) }]
                    }
                );
                console.log("<< Subscription added to kafka >>")
                res.status(201).send('new subscription added.');
            } catch (err) {
                console.log(err);
                res.status(501).send('issue');
            } finally {
                await producer.disconnect().catch(() => {});
            }
        })


    //put orders in the kafka
    app.put('/user-order',
        verifyClerkToken,
        async (req: Request<{}, {}, {
            customer: string;
            customerEmail: string;
            product: string;//product_id
            transactionId: string;
            orderId: string;
            paymentSignature: string;
            amount: number;
            pincode: number;
            quantity: number;
        }>, res: Response, next: NextFunction) => {
            const producer = kafka.producer();
            try {
                await producer.connect();
                await producer.send({
                    topic: 'update-product-quantity-topic',
                    messages: [{ value: JSON.stringify(req.body) }]
                });

                await sendMailAsync({
                    to: req.body.customerEmail,
                    subject: 'Order Confirmation',
                    html: '<p>Your order has been placed successfully!</p>'
                });

                res.status(200).json({ message: 'Order placed and email sent' });
            } catch (err) {
                console.error('Error processing order:', err);
                res.status(500).json({ error: 'Failed to process order' });
            } finally {
                await producer.disconnect().catch(() => {});
            }
        });

    // ✅ REFUND ENDPOINT - Process refunds for partial/failed orders
    app.post('/process-refund',
        verifyClerkToken,
        async (req: Request<{}, {}, {
            orderId: string;
            transactionId: string;
            refundAmount: number;
            reason: string;
            customerEmail: string;
        }>, res: Response) => {
            try {
                const { orderId, transactionId, refundAmount, reason, customerEmail } = req.body;

                // Validate refund amount
                if (!refundAmount || refundAmount <= 0) {
                    res.status(400).json({
                        status: 400,
                        error: {
                            message: 'Invalid refund amount'
                        }
                    });
                    return;
                }

                // Create Razorpay client
                const razorpay = new Razorpay({
                    key_id: process.env.RAZORPAY_PUBLIC_KEY || '',
                    key_secret: process.env.RAZORPAY_SECRET_KEY
                });

                try {
                    // Process refund through Razorpay
                    const refundResponse: any = await razorpay.payments.refund(transactionId, {
                        amount: Math.round(refundAmount * 100), // Convert to paise
                        notes: {
                            orderId: orderId,
                            reason: reason
                        }
                    });

                    console.log('Refund processed successfully:', {
                        orderId,
                        refundId: refundResponse.id,
                        amount: refundAmount,
                        status: refundResponse.status
                    });

                    // Send refund confirmation email
                    await sendMailAsync({
                        to: customerEmail,
                        subject: `Refund Processed for Order ${orderId}`,
                        html: `
                            <h2>Refund Confirmation</h2>
                            <p>Your refund of ₹${refundAmount.toFixed(2)} has been processed successfully.</p>
                            <p><strong>Reason:</strong> ${reason}</p>
                            <p><strong>Refund ID:</strong> ${refundResponse.id}</p>
                            <p><strong>Status:</strong> ${refundResponse.status}</p>
                            <p>The amount will be credited to your account within 3-5 business days.</p>
                        `
                    });

                    res.status(200).json({
                        status: 200,
                        message: 'Refund processed successfully',
                        refundData: {
                            refundId: refundResponse.id,
                            amount: refundAmount,
                            status: refundResponse.status,
                            orderId: orderId
                        }
                    });

                } catch (razorpayError: any) {
                    console.error('Razorpay refund error:', {
                        orderId,
                        error: razorpayError?.message,
                        code: razorpayError?.error?.code
                    });

                    // Handle specific Razorpay errors
                    if (razorpayError?.error?.code === 'BAD_REQUEST_ERROR') {
                        res.status(400).json({
                            status: 400,
                            error: {
                                message: 'Refund cannot be processed. Transaction may have already been refunded or is not eligible for refund.',
                                razorpayCode: razorpayError?.error?.code
                            }
                        });
                    } else {
                        res.status(500).json({
                            status: 500,
                            error: {
                                message: 'Failed to process refund',
                                details: razorpayError?.message
                            }
                        });
                    }
                }

            } catch (error: Error | any) {
                console.error('Refund processing error:', {
                    error: error?.message,
                    stack: error?.stack
                });

                res.status(500).json({
                    status: 500,
                    error: {
                        message: 'Internal server error while processing refund',
                        details: error?.message
                    }
                });
            }
        });


    app.listen(process.env.PORT ?? 5000, () =>
        console.log('listening on PORT:' + process.env.PORT??5000),
    )
}