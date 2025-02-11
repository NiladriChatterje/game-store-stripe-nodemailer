import { parentPort, workerData } from 'worker_threads';
import nodemailer from 'nodemailer';
export function sendEmail({ recipient, confirmation }) {
    return new Promise((resolve, reject) => {
        const transportObject = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.AUTH_EMAIL,
                pass: process.env.APP_KEY
            }
        });
        console.log(recipient);
        console.log(confirmation);
        const mailConfig = {
            from: process.env.AUTH_EMAIL,
            to: recipient,
            subject: 'Email Verification XVStore',
            text: `Do Not share the OTP \n The Confirmation OTP is : ${confirmation}\n\n\n Thanks for visiting.\nRegards` //Message actually
        };
        transportObject.sendMail(mailConfig, (error, info) => {
            if (error) {
                console.log(error);
                reject({ message: 'An error has occured' });
            }
            resolve({ message: 'Successfully Sent' });
        });
    });
}
sendEmail(workerData)
    .then((resolve) => {
    parentPort === null || parentPort === void 0 ? void 0 : parentPort.postMessage(true);
})
    .catch(e => parentPort === null || parentPort === void 0 ? void 0 : parentPort.postMessage(false));
