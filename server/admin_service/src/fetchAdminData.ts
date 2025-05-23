import { sanityConfig } from "./utils/index.js";
import { SanityClient, createClient } from "@sanity/client";
import { workerData, parentPort } from "node:worker_threads";

async function getAdminData({ _id }: { _id: string }) {
  const sanityClient: SanityClient = createClient(sanityConfig);
  const result = await sanityClient?.fetch(
    `*[_type=='admin' && _id=='${_id}']`
  );

  parentPort?.postMessage({ status: 200, result: result });
}

getAdminData(workerData).catch((_err) => {
  parentPort?.postMessage({ status: 500, result: [] });
});
