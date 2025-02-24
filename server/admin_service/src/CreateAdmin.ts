import {Kafka, RecordMetadata,logLevel} from 'kafkajs';
import { parentPort, workerData } from 'worker_threads';
import { AdminFieldsType } from './delcarations/AdminFieldType';
import process from 'process';

const kafka = new Kafka({
    clientId:'xv store',
    brokers:['localhost:9092'],
    retry:{
        retries:2
    },
    logLevel:logLevel.ERROR,
    logCreator:(logEntry)=>{
        return ({ namespace, level, label, log }) => {
            const { message, ...extra } = log
            parentPort?.postMessage({status:503,value:"kafka-error | Admin document creation failed"});
            process.exit(0);
        }
    }
})

async function createAdmin(value:AdminFieldsType){
    console.log("<createAmin-Worker-received-data-from-parent> : ",value)
    let producer;
    try{
        producer = kafka.producer({allowAutoTopicCreation:false});
        
        await producer.connect()

        const recordMetaData : RecordMetadata[]= await producer.sendBatch({
            topicMessages:[{topic:'create-admin-record',messages:[{value:JSON.stringify(value)}]}]
        });
        
        producer.on('producer.network.request_timeout',ev=>{
            parentPort?.postMessage({status:503,value:"session timeout! Couldn't create profile."});
        });

        parentPort?.postMessage({status:201,value:'Admin document created.'});
        
    }
    finally{
        producer?.disconnect();
    }
    
}

createAdmin(workerData.value);