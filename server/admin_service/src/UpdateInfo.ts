import { Kafka } from 'kafkajs'
import { workerData } from 'worker_threads'

const kafka = new Kafka({
  clientId: 'xv store',
  brokers: ['localhost:9092', 'localhost:9093'],
})

async function updateInfo() {
  const producer = kafka.producer()
  await producer.connect()
}
