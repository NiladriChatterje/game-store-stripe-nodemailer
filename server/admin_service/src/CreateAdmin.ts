import {Kafka} from 'kafkajs';
import { parentPort, workerData } from 'worker_threads';

const kafka = new Kafka({
    clientId:'xv store',
    brokers:['localhost:9092']
})

async function createAdmin(){
    const producer = kafka.producer();
    await producer.connect()

    const recordMetaData = await producer.send({
        topic:'create-admin-record',
        messages:[{value:workerData}]
    });

    parentPort?.postMessage(recordMetaData);
    producer.disconnect();
}

createAdmin();