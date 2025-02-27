import { createClient, SanityClient } from '@sanity/client'
import { sanityConfig } from '@utils/index.js'
import { workerData, parentPort } from 'node:worker_threads'

async function getProduct({productId,adminId}:{productId:string;adminId:string}) {
const sanityClient :SanityClient = createClient(sanityConfig);
return sanityClient.fetch(`*[_type=='product' && productId=='${productId}' && seller[].admin._id=='${adminId}']`); 
}

getProduct(workerData).then(result=>{
    parentPort?.postMessage(result);
}).catch(err=>parentPort?.postMessage([]));
