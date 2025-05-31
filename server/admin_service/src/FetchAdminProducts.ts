import { createClient, SanityClient } from '@sanity/client'
import { sanityConfig } from './utils';

export async function getUserOrders(
  adminId: string) {
  const sanityClient: SanityClient = createClient(sanityConfig);
  const result = await sanityClient.fetch(
    `[_type="admin" && _id="${adminId}"]{productReferenceAfterListing}`,
  )
  return result
}
