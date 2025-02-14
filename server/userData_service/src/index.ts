import { Worker } from 'worker_threads';
import cluster from 'cluster';
import express, { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { availableParallelism } from 'os';
dotenv.config();


if (cluster.isPrimary) {
    new Worker('./dist/BackgroundPingProcess.js');

    let p;
    for (let i = 0; i < availableParallelism(); i++) {
        p = cluster.fork();
        p.on('exit', (_statusCode: number) => {
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
        res.end('pinged!')
    });

    app.get('/fetch-user-data/:userId', (req: Request, res: Response) => {
        console.log(req.params.userId);
        // const NotClonedObject = {
        //     workerData: {
        //         value: req.body
        //     },
        //     transferList: req.body
        // }
        // const worker = new Worker('./dist/EmailWorker.js', NotClonedObject);
        // worker.on('message', (value: boolean) => {
        //     res.send(value);
        // });
        res.write("hello guys");
    });

    app.post("/razorpay", async (req: Request, res: Response) => {
        const { price, currency } = req.body
        console.log(price);
        console.log(req.body);
        const worker_razorpay = new Worker('./dist/RazorpayProcess.js', {
            workerData: {
                price, currency
            }
        });

        worker_razorpay.on('message', (msg_event) => {
            console.log('message : ' + msg_event);
            res.json(msg_event)
        })
    });

    app.post('/add-product', async (req: Request<{}, {}>, res: Response) => {

        // let h = 0
        // for (let i = 0; i < bufferArr.length; i++) {
        //     writeFile('./dist/uploads/' + h + `.${imagesBase64[i].extension}`, bufferArr[i], 'binary', (err) => {
        //         if (err)
        //             console.log(err);
        //     });
        //     h++
        // }
        const worker = new Worker('./dist/ProductDetailsHandling.js')
        worker.on('message', (data) => {

        });
        worker.postMessage(req.body, [req.body])
        res.end('ok')
    })

    app.post('/save-subscription', async (req: Request, res: Response) => {
        const { adminId, admin_document_id, plan } = req.body;
        const worker = new Worker('./dist/updateAdminSubsTransactionToDB.js', {
            workerData: { adminId, plan },
            transferList: [adminId, plan]
        });
        worker.on('message', (data) => {
            res.json(data);
        })
    })

    app.post('/fetch-mail-otp', (req: Request, res: Response) => {
        const OTP = Math.trunc(Math.random() * 10 ** 6);
        const worker = new Worker('./dist/EmailWorker.js', {
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
        const worker = new Worker('./dist/PhoneWorker.js', {
            workerData: {

                recipient: req.body?.phone,
                confirmation: OTP

            }
        });

    });

    app.listen(process.env.PORT, () => console.log('listening on PORT:' + process.env.PORT))

}
