import {Kafka} from 'kafkajs';
import { parentPort, workerData } from 'worker_threads';
import { AdminFieldsType } from './delcarations/AdminFieldType';

const kafka = new Kafka({
    clientId:'xv store',
    brokers:['localhost:9092']
})

async function createAdmin(value:AdminFieldsType){
    const producer = kafka.producer();
    await producer.connect()

    const recordMetaData = await producer.send({
        topic:'create-admin-record',
        messages:[{value:JSON.stringify(value)}]
    });

    parentPort?.postMessage(recordMetaData);
    producer.disconnect();
}

createAdmin(workerData.value);