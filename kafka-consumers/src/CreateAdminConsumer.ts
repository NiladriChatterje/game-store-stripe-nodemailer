import { createClient, SanityClient } from '@sanity/client';
import {EachMessagePayload, Kafka} from 'kafkajs';
import { sanityConfig } from './utils';
import { AdminFieldsType } from '@declaration/index';

async function createAdmin(){
    const kafka = new Kafka({
        clientId:'xvstore',
        brokers:["localhost:9092"]
    });

    const consumer = kafka.consumer({groupId:'admin-record'});
    await consumer.connect();
    await consumer.subscribe({topic:'create-admin-record'})

    const sanityClient : SanityClient = createClient(sanityConfig);

    
    async function handleMessage({heartbeat,pause,message,topic,partition}:EachMessagePayload){
        const user:AdminFieldsType = JSON.parse(message.value.toString());
        await sanityClient?.create({
            _type:'admin',
            adminId:user.adminId
        });
       
    }

    consumer.run({
        eachMessage:handleMessage
    })
    
}

/*Structure sent while producing */
// sanityClient?.create({
//     _type: 'admin',
//     username: user?.firstName,
//     adminId: user?.id,
//     email: user?.emailAddresses[0].emailAddress,
//     geoPoint: {
//       lat: latitude,
//       lng: longitude,
//     },
//     address: {
//       pinCode: placeResult?.properties?.postcode,
//       county: placeResult?.properties?.county,
//       state: placeResult?.properties?.state,
//       country: placeResult?.properties?.country,
//     },
//   })