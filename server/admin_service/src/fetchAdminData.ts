import { SanityClient } from '@sanity/client'
import { workerData, parentPort } from 'node:worker_threads'

async function getAdminData({sanityClient,adminId}:{adminId:string;sanityClient:SanityClient}) {
    await sanityClient?.fetch(
        `*[_type=='admin' && adminId=='${adminId}']`,
      )
}

getAdminData(workerData)