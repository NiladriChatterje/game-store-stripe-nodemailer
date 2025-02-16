import {  SanityClient } from '@sanity/client'
import { workerData, parentPort } from 'node:worker_threads'

async function getUSerData({sanityClient,userId}:{userId:string;sanityClient:SanityClient}) {
    const result = await sanityClient?.fetch(
        `*[_type=='user' && userId=='${userId}']`,
      );
      return result;
}

getUSerData(workerData);
