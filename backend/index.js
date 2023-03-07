const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb' }));
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
})

function sendEmail({ recipient, confirmation }) {
    return new Promise((resolve, reject) => {
        transportObject = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: 'ecartxvstore@gmail.com',
                pass: process.env.APP_KEY
            }
        });

        console.log(recipient);
        console.log(confirmation)

        const mailConfig = {
            from: 'ecartxvstore@gmail.com',
            to: recipient,
            subject: 'Email Verification XVStore',
            text: `Do Not share the OTP \n The Confirmation OTP is : ${confirmation}\n\n\n Thanks for visiting.\nRegards`//Message actually
        };

        transportObject.sendMail(mailConfig, (error, info) => {
            if (error) {
                console.log(error);
                return reject({ message: 'An error has occured' })
            }
            return resolve({ message: 'Successfully Sent' })
        })
    })
}

app.get('/', (res, req) => {
    sendEmail().then(res => res.send())
        .catch(e => res.status(500));
});

app.post('/send_email', (req, res) => {
    sendEmail(req.body).then(res => res.send())
        .catch(e => res.status(500).send(e.message));
});
app.listen(PORT, () => console.log('listening on PORT:' + PORT))