import { parentPort, workerData } from 'node:worker_threads';
import Razorpay from 'razorpay'
import shortid from 'shortid';
import dotenv from 'dotenv';
dotenv.config();

async function createOrderID({ price, currency }: { price: string, currency: string }) {
    try {

        const razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_PUBLIC_KEY,
            key_secret: process.env.RAZORPAY_SECRET_KEY
        });
        const response = await razorpay.orders.create({
            amount: Number(price),
            currency,
            receipt: shortid()
        });
        parentPort?.postMessage({ ...response, status: 200 })
    } catch (e: Error | any) {
        parentPort?.postMessage({
            status: 500,
            error: {
                message: e?.message,
            },
        });
    }

}

createOrderID(workerData);
