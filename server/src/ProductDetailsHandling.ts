import { workerData, parentPort } from 'node:worker_threads';
import type { productType } from '@/declaration.d.ts';
import { Buffer } from 'node:buffer';

async function structuringDataAccordingToSanitySchema(workerData: productType) {
    const { imagesBase64 }: { imagesBase64: { extension: string; base64: string }[] } = workerData

    const bufferArr: Buffer[] = [] as Buffer<ArrayBuffer>[]
    for (let i of imagesBase64)
        bufferArr.push(Buffer.from(i.base64?.split(',')[1], 'base64'));//spliting because we only need data and not what encoding type
}

structuringDataAccordingToSanitySchema(workerData).then(resolved => {

})