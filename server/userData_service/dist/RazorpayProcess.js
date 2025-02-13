var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { parentPort, workerData } from 'node:worker_threads';
import Razorpay from 'razorpay';
import shortid from 'shortid';
import dotenv from 'dotenv';
dotenv.config();
function createOrderID(_a) {
    return __awaiter(this, arguments, void 0, function* ({ price, currency }) {
        try {
            const razorpay = new Razorpay({
                key_id: process.env.RAZORPAY_PUBLIC_KEY || '',
                key_secret: process.env.RAZORPAY_SECRET_KEY
            });
            const response = yield razorpay.orders.create({
                amount: Number(price),
                currency,
                receipt: shortid()
            });
            parentPort === null || parentPort === void 0 ? void 0 : parentPort.postMessage(Object.assign(Object.assign({}, response), { status: 200 }));
        }
        catch (e) {
            parentPort === null || parentPort === void 0 ? void 0 : parentPort.postMessage({
                status: 500,
                error: {
                    message: e === null || e === void 0 ? void 0 : e.message,
                },
            });
        }
    });
}
createOrderID(workerData);
