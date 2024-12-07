import { parentPort, workerData } from 'node:worker_threads';
import Razorpay from 'razorpay'
import shortid from 'shortid'

async function createOrderID({ price, currency }) {
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
        console.log(response)
        parentPort.postMessage(response)
    } catch (e) {
        parentPort.postMessage({
            error: {
                message: e.message,
            },
        });
    }

}

createOrderID(workerData);
