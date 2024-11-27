
import { Worker } from 'worker_threads';
import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import cluster from 'cluster';
import express, { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import shortid from 'shortid';

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

    app.post("/razorpay", async (req: Request, res: Response) => {
        const { price, currency } = req.body
        console.log(price);
        console.log(req.body);
        try {
            const razorpay = new Razorpay({
                key_id: process.env.RAZORPAY_PUBLIC_KEY,
                key_secret: process.env.RAZORPAY_SECRET_KEY
            });
            const response = await razorpay.orders.create({
                amount: Number(price),
                currency: 'INR',
                receipt: shortid()
            });
            console.log(response)
            res.json(response);
        } catch (e: Error | any) {
            res.status(400).send({
                error: {
                    message: e.message,
                },
            });
        }
    });
    app.post('/fetch-mail-otp', (req: Request, res: Response) => {
        const OTP = Math.trunc(Math.random() * 10 ** 6);
        const worker = new Worker('./src/EmailWorker.js', {
            workerData: {
                recipient: req.body?.recipient,
                confirmation: OTP
            }
        });
        worker.on('message', (data) => {
            if (data) res.status(200).json({ OTP });
            else res.status(500).json({ OTP: -1 })
        });
    });

    app.post('/fetch-phone-otp', (req: Request, res: Response) => {
        const OTP = Math.trunc(Math.random() * 10 ** 6);
        const worker = new Worker('./src/PhoneWorker.js', {
            workerData: {

                recipient: req.body?.phone,
                confirmation: OTP

            }
        });

    });

    app.listen(process.env.PORT, () => console.log('listening on PORT:' + process.env.PORT))

}
