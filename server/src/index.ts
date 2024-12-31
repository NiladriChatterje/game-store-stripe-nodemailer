
import { Worker } from 'worker_threads';
import cluster from 'cluster';
import express, { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

type sendMailFunctionParamsTypeDeclaration = {
    recipient: string; confirmation: number;
}
import { availableParallelism } from 'os';
import { createClient } from '@sanity/client';

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

    const sanityClient = createClient({
        projectId: process.env.SANITY_PROJECT_ID,
        dataset: 'production',
        apiVersion: '2024-12-21',
        useCdn: true,
        token: process.env.SANITY_TOKEN
    });

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
        const worker_razorpay = new Worker('./src/RazorpayProcess.js', {
            workerData: {
                price, currency
            }
        });

        worker_razorpay.on('message', (msg_event) => {
            console.log('message : ' + msg_event);
            res.json(msg_event)
        })
    });

    app.post('/save-subscription', async (req: Request, res: Response) => {
        const { user, plan } = req.body;
        console.log(req.body)
        // sanityClient.create({
        //     _type: ''
        // })
    })

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
