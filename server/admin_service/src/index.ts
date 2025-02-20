import { Worker } from 'worker_threads'
import cluster from 'cluster'
import express, { Express, NextFunction, Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { availableParallelism } from 'os'
import { AdminFieldsType } from './delcarations/AdminFieldType'


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

  app.post(
    '/create-admin',
    (req: Request<{},AdminFieldsType>, res: Response) => {
      console.log(req.body);
      const NotClonedObject = {
        workerData: {
          value:req.body,
        }
      }
      let worker = new Worker('./dist/CreateAdmin.js', NotClonedObject);

      worker.on('message', (logLevel:{value:string;status:number}) => {
        console.log("<create Admin worker> : ",logLevel); 
          res.status(logLevel.status).json(logLevel.value);
      })

      //respinning worker on failure
      worker.on('error', (_error:Error) => {
        console.log("<createAdmin-Worker-error>");
        console.log("<Restarting-another-createAdmin-Worker>");

        worker = new Worker('./dist/CreateAdmin.js', NotClonedObject);
        
        worker.on('message', (logLevel:{value:string;status:number}) => {
          console.log("<create Admin worker> : ",logLevel); 
            res.status(logLevel.status).json(logLevel.value);
        })
      })
    },
  );


  app.get(
    '/fetch-admin-data/:adminId',
    (req: Request<{ adminId: string }>, res: Response) => {
      console.log(req.params.adminId)
      const NotClonedObject = {
        workerData: {
          adminId: req.params.adminId,
        }
      }
      const worker = new Worker('./dist/fetchAdminData.js', NotClonedObject)
      worker.on('message', (value) => {
        console.log(value)
        res.status(value.status).json(value.result)
      })

      worker.on('error', (value) => {
        res.status(200).send(value)
      })
    },
  )

  app.patch(
    '/update-info',
    (
      req: Request<
        {},
        {},
        {
          userId: string
        }
      >,
      res: Response,
    ) => {
      const worker = new Worker('./dist/UpdateInfo.js', {
        workerData: {
          userId: req.body.userId,
        },
      })

      worker.on('message', data => {})
    },
  )

  app.get(
    '/:adminId/product-list',
    (req: Request<{ adminId: string }>, res: Response) => {
      const worker = new Worker('./dist/AdminProducts.js', {
        workerData: {
          userId: req.params.adminId,
        },
      })

      worker.on('message', data => {
        res.status(200).send(data)
      })
    },
  )

  app.post('/fetch-phone-otp', (req: Request, res: Response) => {
    const OTP = Math.trunc(Math.random() * 10 ** 6)
    const worker = new Worker('./dist/PhoneWorker.js', {
      workerData: {
        recipient: req.body?.phone,
        confirmation: OTP,
      },
    })
  })

  app.listen(process.env.PORT, () =>
    console.log('listening on PORT:' + process.env.PORT),
  )
}
