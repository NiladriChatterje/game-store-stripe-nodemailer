import { Worker } from 'worker_threads'
import cluster from 'cluster'
import express, { Express, NextFunction, Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { availableParallelism } from 'os'
import { Kafka, Producer } from 'kafkajs'
import { spawn } from 'child_process'
import { type Subscription } from '@declaration/index'
import { ClerkExpressRequireAuth, clerkClient } from '@clerk/clerk-sdk-node'
dotenv.config()

if (cluster.isPrimary) {
    let old_child_process: any[] = []
    setInterval(() => {
        const child_process = spawn('curl.exe', [
            '-X',
            'GET',
            `http://localhost:${process.env.PORT ?? 5000}/`,
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

    let p
    for (let i = 0; i < availableParallelism(); i++) {
        p = cluster.fork()
        p.on('exit', (_statusCode: number) => {
            p = cluster.fork()
        })
    }
} else {
    const app: Express = express();
    const kafka = new Kafka({
        clientId: 'xv-store',
        brokers: ['localhost:9092', 'localhost:9093', 'localhost:9094']
    })

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

    app.post('/razorpay', async (req: Request, res: Response) => {
        const { price, currency } = req.body
        console.log(price)
        console.log(req.body)
        const worker_razorpay = new Worker('./dist/RazorpayProcess.js', {
            workerData: {
                price,
                currency,
            },
        })

        worker_razorpay.on('message', msg_event => {
            console.log('message : ' + msg_event)
            res.json(msg_event)
        })
    })


    app.post('/admin-subscription',
        ClerkExpressRequireAuth() as any,
        async (req: Request<{}, {}, { _id: string, subscription: Subscription }>, res: Response, next: NextFunction) => {

            next()
        },
        async (req: Request<{}, {}, { _id: string, subscription: Subscription }>, res: Response) => {
            try {
                const { _id, subscription } = req.body;
                const producer: Producer = kafka.producer();
                await producer.connect();
                await producer.send(
                    {
                        topic: 'update-admin',
                        messages: [{ value: JSON.stringify({ _id, subscription }) }]
                    }
                );
                await producer.disconnect()
                res.status(200).send('new subscription added.');
            } catch (err) {
                console.log(err);
                res.status(501).send('issue');
            }
        })


    //put orders in the kafka
    app.put('/user-order',
        ClerkExpressRequireAuth() as any,
        async (req: Request, res: Response, next: NextFunction) => {
            res.send(await clerkClient.users.getUserList())
        });


    app.listen(process.env.PORT ?? 5000, () =>
        console.log('listening on PORT:' + process.env.PORT),
    )
}