var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { Worker } from 'worker_threads';
import cluster from 'cluster';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { availableParallelism } from 'os';
import { Buffer } from 'node:buffer';
// import multer, { diskStorage, Multer, StorageEngine } from 'multer';
dotenv.config();
// const diskStorageConfig = diskStorage({
//     destination(req, file, callback) {
//         console.log(file);
//         callback(null, 'uploaded-images/');
//     },
//     // filename: (req, file, callback) => {
//     // }
// });
// const upload = multer({ storage: diskStorageConfig })
if (cluster.isPrimary) {
    new Worker('./dist/BackgroundPingProcess.js');
    let p;
    for (let i = 0; i < availableParallelism(); i++) {
        p = cluster.fork();
        p.on('exit', (statusCode) => {
            p = cluster.fork();
        });
    }
}
else {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '25mb' }));
    app.use(express.urlencoded({ extended: true, limit: '25mb' }));
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        next();
    });
    app.get('/', (req, res) => {
        res.end('pinged!');
    });
    app.get('/test-endpoint', (req, res) => {
        console.log('test!');
        res.end('tested');
    });
    app.post('/send-email', (req, res) => {
        console.log(req.body);
        const NotClonedObject = {
            workerData: {
                value: req.body
            },
            transferList: req.body
        };
        const worker = new Worker('./dist/EmailWorker.js', NotClonedObject);
        worker.on('message', (value) => {
            res.send(value);
        });
    });
    app.post("/razorpay", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { price, currency } = req.body;
        console.log(price);
        console.log(req.body);
        const worker_razorpay = new Worker('./dist/RazorpayProcess.js', {
            workerData: {
                price, currency
            }
        });
        worker_razorpay.on('message', (msg_event) => {
            console.log('message : ' + msg_event);
            res.json(msg_event);
        });
    }));
    app.post('/add-product', (req, res) => {
        const { imagesBase64 } = req.body;
        console.log(req.headers);
        console.log(req.body);
        const bufferArr = [];
        for (let i of imagesBase64)
            bufferArr.push(Buffer.from(i, 'base64'));
        console.log('image array buffer', bufferArr);
        res.end('ok');
    });
    app.post('/save-subscription', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
        const { admin, plan } = req.body;
        const worker = new Worker('./dist/updateAdminSubsTransactionToDB.js', {
            workerData: { admin, plan },
            transferList: [admin, plan]
        });
        worker.on('message', (data) => {
            res.json(data);
        });
    }));
    app.post('/fetch-mail-otp', (req, res) => {
        var _a;
        const OTP = Math.trunc(Math.random() * 10 ** 6);
        const worker = new Worker('./dist/EmailWorker.js', {
            workerData: {
                recipient: (_a = req.body) === null || _a === void 0 ? void 0 : _a.recipient,
                confirmation: OTP
            }
        });
        worker.on('message', (data) => {
            if (data)
                res.status(200).json({ OTP });
            else
                res.status(500).json({ OTP: -1 });
        });
    });
    app.post('/fetch-phone-otp', (req, res) => {
        var _a;
        const OTP = Math.trunc(Math.random() * 10 ** 6);
        const worker = new Worker('./dist/PhoneWorker.js', {
            workerData: {
                recipient: (_a = req.body) === null || _a === void 0 ? void 0 : _a.phone,
                confirmation: OTP
            }
        });
    });
    app.listen(process.env.PORT, () => console.log('listening on PORT:' + process.env.PORT));
}
