const express = require("express");
const app = express();
require('dotenv').config();
const cors = require('cors');
const { resolve } = require("path");
// Replace if using a different env file or config
const env = require("dotenv").config({ path: "./.env" });

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);


app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb' }));
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

app.use(express());

app.get("/config", (req, res) => {
    res.send({
        publishableKey: process.env.STRIPE_PUBLISHABLE_API,
    });
});

app.post("/create-payment-intent", async (req, res) => {
    const { price } = req.body
    console.log(price)
    console.log(req.body)
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            currency: "inr",
            amount: Number(price),
            automatic_payment_methods: { enabled: true },
        });

        // Send publishable key and PaymentIntent details to client
        res.send({
            clientSecret: paymentIntent.client_secret,
        });
    } catch (e) {
        return res.status(400).send({
            error: {
                message: e.message,
            },
        });
    }
});

app.listen(4242, () =>
    console.log(`Node server listening at http://localhost:4242`)
);