import { parentPort, workerData } from 'node:worker_threads'
import dotenv from 'dotenv'
import { Kafka } from 'kafkajs'
import { ProductType } from '@declaration/index.js'

dotenv.config()

async function addProductData(workerData: ProductType) {
  try {
    const kafka: Kafka = new Kafka({
      clientId: 'xv store',
      brokers: ['localhost:9092', 'localhost:9093'],
      ssl: true,
    })

    const producer = kafka.producer()
    producer.connect()
    producer.send({
      topic: '',
      messages: [{ key: '', value: '' }],
    })
  } catch (e: Error | any) {
    parentPort?.postMessage({
      status: 500,
      error: {
        message: e?.message,
      },
    })
  }
}

addProductData(workerData)
