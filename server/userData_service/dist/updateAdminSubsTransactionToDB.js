var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var _a, _b;
import { parentPort, workerData } from "worker_threads";
import { Kafka } from 'kafkajs';
import { createClient } from "@sanity/client";
import dotenv from 'dotenv';
dotenv.config();
const sanityConfig = {
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: 'production',
    apiVersion: '2024-12-21',
    useCdn: true,
    token: process.env.SANITY_TOKEN
};
const sanityClient = createClient(sanityConfig);
const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: [(_a = process.env.BROKER_HOST_1) !== null && _a !== void 0 ? _a : 'localhost:9092', (_b = process.env.BROKER_HOST_2) !== null && _b !== void 0 ? _b : 'localhost:9093']
});
const producer = kafka.producer();
function produce() {
    return __awaiter(this, void 0, void 0, function* () {
        yield producer.connect();
        producer.send({
            topic: 'admin-subscription-transaction',
            messages: [{ value: JSON.stringify(workerData) }]
        }).then(result => {
            console.log(result);
        }).finally(() => __awaiter(this, void 0, void 0, function* () {
            yield producer.disconnect();
        }));
    });
}
produce().then(() => {
    parentPort === null || parentPort === void 0 ? void 0 : parentPort.postMessage({ status: 200, msg: 'Produced successfully' });
}).catch(() => {
    parentPort === null || parentPort === void 0 ? void 0 : parentPort.postMessage({ status: 500, msg: 'Error while producing message!' });
});
