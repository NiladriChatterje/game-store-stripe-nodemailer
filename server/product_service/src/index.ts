import { Worker } from 'worker_threads'
import cluster from 'cluster'
import express, { Express, NextFunction, Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { availableParallelism } from 'os'
import { ProductType } from '@declaration/index.js'
import { sanityConfig } from '@utils/index.js'
import { createClient } from '@sanity/client'
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
  const app: Express = express();
  const sanityClient = createClient(sanityConfig);

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

  app.get('/fetch-all-products', async (req: Request, res: Response) => {
    res.end(await sanityClient.fetch(`*[_type=="product"]`))
  })

  app.get(
    '/:_id/fetch-products',
    (req: Request<{ _id:string }>, res: Response) => {
      console.log(req.params._id)
      const NotClonedObject = {
        workerData: {
          adminId:req.params._id
        },
      }
      const worker = new Worker('./dist/fetchAllProductsOfCurrentAdmin.js', NotClonedObject)
      worker.on('message', (value: ProductType[]) => {
        console.log(value)
        res.status(200).json(value)
      })
      worker.on('error', (err: Error) => {
        res.status(503).json('Service is down!')
      })
    },
  )
  
  app.get(
    '/:adminId/fetch-product/:productId',
    (req: Request<{ productId: string,adminId:string }>, res: Response) => {
      console.log(req.params.productId)
      const NotClonedObject = {
        workerData: {
          productId: req.params.productId,
          adminId:req.params.adminId
        },
      }
      const worker = new Worker('./dist/fetchProductData.js', NotClonedObject)
      worker.on('message', (value: ProductType[]) => {
        console.log("Product Data of id "+req.params.productId+" : "+value)
        res.status(200).send(value)
      })
      worker.on('error', (err: Error) => {
        res.status(503).send('Service is down!')
      })
    },
  )

  //post to create the product
  app.post('/add-product', async (req: Request<{}, {},ProductType>, res: Response) => {
  
    const worker = new Worker('./dist/AddProductData.js',{
      workerData:req.body
    });

    worker.on('message', data => {res.status(data.status).send(data.value)})

  })

  //patch to update same product
  app.patch('/update-product', async (req: Request, res: Response) => {
    const { adminId, admin_document_id, plan } = req.body
    const worker = new Worker('./dist/updateAdminSubsTransactionToDB.js', {
      workerData: { adminId, plan },
      transferList: [adminId, plan],
    })
    worker.on('message', data => {
      res.json(data)
    })
  })

  app.listen(process.env.PORT, () =>
    console.log('listening on PORT:' + process.env.PORT),
  )
}
