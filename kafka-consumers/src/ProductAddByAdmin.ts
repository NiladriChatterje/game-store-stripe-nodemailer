import cluster from 'node:cluster';
import { EachMessagePayload, Kafka, logLevel } from 'kafkajs';
import { availableParallelism } from 'node:os';
import { createClient, SanityClient } from '@sanity/client';
import { ProductType } from '@declaration/productType';
import { sanityConfig } from '@utils';


const kafka: Kafka = new Kafka({
    clientId: 'xvstore',
    brokers: ['localhost:9092', 'localhost:9093','localhost:9094'],
    ssl:true
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
           //pause - resume for db operation & embedding creation
           const resume = pause();
           try{
            const productPayload : ProductType = JSON.parse(message.value.toString());
               const result = await sanityClient.create({_type:'product',...productPayload});
               productPayload._id = result._id;
               const success =await  sanityClient.patch(productPayload._id).append('productReferenceAfterListing',[productPayload]).commit();
                
               resume(); 
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