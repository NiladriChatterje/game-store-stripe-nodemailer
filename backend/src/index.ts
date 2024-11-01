
import { Worker } from 'worker_threads';
import cluster from 'cluster';
import express, { Express, NextFunction, Request, Response } from 'express';
import nodemailer, { SentMessageInfo } from 'nodemailer';
import cors from 'cors';
import Stripe from 'stripe';
import dotenv from 'dotenv';
dotenv.config();

type sendMailFunctionParamsTypeDeclaration = {
    recipient: string; confirmation: number;
}
import { availableParallelism } from 'os';

if (cluster.isPrimary) {
    new Worker('./src/BackgroundPingProcess.js');
    let p;
    for (let i = 0; i < availableParallelism(); i++) {
        p = cluster.fork();
        p.on('exit', (statusCode: number) => {
            p = cluster.fork();
        })
    }
} else {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
    const app: Express = express();


    app.use(cors());
    app.use(express.json({ limit: '25mb' }));
    app.use(express.urlencoded({ extended: true, limit: '25mb' }));
    app.use((req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        next();
    })


    app.get('/', (req: Request, res: Response) => {
        res.send('pinged!');
    });

    app.get('/test-endpoint', (req: Request, res: Response) => {
        console.log('test!');
        res.end('tested')
    });

    app.post('/send-email', (req: Request, res: Response) => {
        console.log(req.body)
        const NotClonedObject = {
            workerData: {
                value: req.body
            },
            transferList: req.body
        }
        const worker = new Worker('./src/EmailWorker.js', NotClonedObject);
        worker.on('message', (value: boolean) => {
            res.send(value);
        });
    });

    app.post("/create-payment-intent", async (req: Request, res: Response) => {
        const { price } = req.body
        console.log(price);
        console.log(req.body);
        try {
            const paymentIntent: Stripe.PaymentIntent = await stripe.paymentIntents.create({
                currency: "inr",
                amount: Number(price),
                automatic_payment_methods: { enabled: true },
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        } catch (e: Error | any) {
            res.status(400).send({
                error: {
                    message: e.message,
                },
            });
        }
    });

    app.listen(process.env.PORT, () => console.log('listening on PORT:' + process.env.PORT))

}
