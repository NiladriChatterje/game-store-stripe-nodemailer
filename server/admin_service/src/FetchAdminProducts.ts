import { workerData, parentPort } from 'node:worker_threads'
import { SanityClient } from '@sanity/client'

async function getUserOrders({
  adminId,
  sanityClient,
}: {
  adminId: string
  sanityClient: SanityClient
}) {
  const result = await sanityClient.fetch(
    `[_type="admin" && _id="${adminId}"]{productReferenceAfterListing}`,
  )
  return result
}

getUserOrders(workerData)
  .then(result => {
    parentPort?.postMessage(result, [result])
  })
  .catch(error => {
    parentPort?.postMessage([])
  })
