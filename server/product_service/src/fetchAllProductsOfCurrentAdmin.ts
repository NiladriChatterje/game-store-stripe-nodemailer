import { workerData, parentPort } from 'node:worker_threads'
import { createClient,SanityClient } from '@sanity/client';
import { sanityConfig } from './utils/index.js';

async function fetchAllProductsOfCurrentAdmin({adminId}: {adminId:string}) {

 const sanityClient :SanityClient = createClient(sanityConfig);
 return await sanityClient.fetch(`*[_type=='admin' && adminId=='${adminId}']`) 
 
 }

 fetchAllProductsOfCurrentAdmin(workerData).then(result=>{
    parentPort?.postMessage(result)
}).catch(err=>parentPort?.postMessage([]));