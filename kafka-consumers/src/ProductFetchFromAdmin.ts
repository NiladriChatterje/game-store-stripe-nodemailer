import cluster from 'node:cluster';
import { EachMessagePayload, Kafka, logLevel } from 'kafkajs';
import { availableParallelism } from 'node:os';
import { createClient, SanityClient } from '@sanity/client';
import {Server} from 'socket.io';
import { AdminFieldsType } from '@declaration/index';

const sanityConfig = {
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: 'production',
    apiVersion: '2024-12-21',
    useCdn: true,
    token: process.env.SANITY_TOKEN,
}

const kafka: Kafka = new Kafka({
    clientId: 'xvstore',
    brokers: ['localhost:9092', 'localhost:9093','localhost:9094'],
    ssl:true,
    
});

if (cluster.isPrimary) {
    let i = 0;
    while (i < availableParallelism()) {
        cluster.fork();
        cluster.on('exit', () => {
            cluster.fork();
        })
    }
}
else {
    const embeddingStore: number[]=[]
    async function main(){
        const sanityClient: SanityClient = createClient({...sanityConfig,perspective:'published'})
        const consumer = kafka.consumer({
            groupId: 'product-from-admin',
        });
    
        await consumer.connect();
        await consumer.subscribe({topic:'product-topic'})
    
        async function handleEachMessages({ heartbeat,message,partition,topic,pause }: EachMessagePayload) {
            console.log("<arrayBufferLike> : ",message.value);
            const productPayload : AdminFieldsType = JSON.parse(message.value.toString());
            const resume = pause();
           //pause - resume for db operation & embedding creation
           try{
               const result = await sanityClient.create({_type:'product'});
               const success =  sanityClient.patch(productPayload.document_id).set({});
               
           }catch(error:Error|any){

           }
        }
    
        consumer.run({
            eachMessage: handleEachMessages,
            eachBatchAutoResolve:false
        })
    }

    main();
}