import express, { Express, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import { Worker } from 'worker_threads';
import dotenv from 'dotenv';
dotenv.config();

const app: Express = express();


app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb' }));
app.use((req, res, next) => {
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

        transportObject.sendMail(mailConfig, (error: Error, info: any) => {
            if (error) {
                console.log(error);
                return reject({ message: 'An error has occured' })
            }
            return resolve({ message: 'Successfully Sent' })
        })
    })
}

app.get('/', (req: Request, res: Response) => {
    res.send('pinged!');
});

app.get('/test-endpoint', (req: Request, res: Response) => {
    console.log('test!');
    res.end('tested')
});

app.post('/send-email', (req: Request, res: Response) => {
    sendEmail(req.body).then((resolve) => res.send(resolve))
        .catch(e => res.status(500).send(e.message));
});

new Worker('./src/BackgroundPingProcess.js');

app.listen(process.env.PORT, () => console.log('listening on PORT:' + process.env.PORT))