
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

    function sendEmail({ recipient, confirmation }: {
        recipient: string; confirmation: number;
    }) {
        return new Promise((resolve, reject) => {
            const transportObject = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.AUTH_EMAIL,
                    pass: process.env.APP_KEY
                }
            });

            console.log(recipient);
            console.log(confirmation)

            const mailConfig = {
                from: process.env.AUTH_EMAIL,
                to: recipient,
                subject: 'Email Verification XVStore',
                text: `Do Not share the OTP \n The Confirmation OTP is : ${confirmation}\n\n\n Thanks for visiting.\nRegards`//Message actually
            };

            transportObject.sendMail(mailConfig, (error: Error | null, info: SentMessageInfo) => {
                if (error) {
                    console.log(error);
                    reject({ message: 'An error has occured' })
                }
                resolve({ message: 'Successfully Sent' })
            })
        })
    }

    app.get('/', (req: Request, res: Response) => {
        res.send('pinged!');
    });

    app.get('/test-endpoint', (req, res) => {
        console.log('test!');
        res.end('tested')
    });

    app.post('/send-email', (req, res) => {
        sendEmail(req.body).then((resolve) => res.send(resolve))
            .catch(e => res.status(500).send(e.message));
    });

    app.post("/create-payment-intent", async (req, res) => {
        const { price } = req.body
        console.log(price);
        console.log(req.body);
        try {
            const paymentIntent = await stripe.paymentIntents.create({
                currency: "inr",
                amount: Number(price),
                automatic_payment_methods: { enabled: true },
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        } catch (e: any) {
            res.status(400).send({
                error: {
                    message: e.message,
                },
            });
        }
    });

    app.listen(process.env.PORT, () => console.log('listening on PORT:' + process.env.PORT))

}
