import { Worker } from 'worker_threads'
import cluster from 'cluster'
import express, { Express, NextFunction, Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { availableParallelism } from 'os'
dotenv.config()

if (cluster.isPrimary) {
    new Worker('./dist/BackgroundPingProcess.js')

    let p
    for (let i = 0; i < availableParallelism(); i++) {
        p = cluster.fork()
        p.on('exit', (_statusCode: number) => {
            p = cluster.fork()
        })
    }
} else {
    const app: Express = express()

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

    app.listen(process.env.PORT ?? 5000, () =>
        console.log('listening on PORT:' + process.env.PORT),
    )
}