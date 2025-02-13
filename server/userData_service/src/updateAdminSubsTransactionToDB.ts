import { parentPort, workerData } from "worker_threads";
import { Kafka } from 'kafkajs';
import { SanityClient, createClient } from "@sanity/client";
import dotenv from 'dotenv'
import { sanityConfig } from '../utils/index.js'
dotenv.config();


const sanityClient: SanityClient = createClient(sanityConfig)
const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: [process.env.BROKER_HOST_1 ?? 'localhost:9092', process.env.BROKER_HOST_2 ?? 'localhost:9093']
});

const producer = kafka.producer();

async function produce() {
    const transaction = await producer.transaction();
    transaction.send({
        topic: 'admin-subscription-transaction',
        messages: [{ value: JSON.stringify(workerData) }]
    }).then(async result => {
        console.log(result);
        //sanity works
        await transaction.commit();
    }).catch(async e => {
        await transaction.abort();
    }).finally(async () => { })
}

produce().then(() => {
    parentPort?.postMessage({ status: 200, msg: 'Produced successfully' })
}).catch(() => {
    parentPort?.postMessage({ status: 500, msg: 'Error while producing message!' });
})