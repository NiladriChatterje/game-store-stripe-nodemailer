import { EachMessagePayload, Kafka } from 'kafkajs';
import { availableParallelism } from 'node:os';
import { createClient, SanityClient } from '@sanity/client';
import dotenv from 'dotenv';
import shortid from 'shortid';
dotenv.config();

const kafka = new Kafka({
    clientId: 'xv-store',
    brokers: ['localhost:9095', 'localhost:9096', 'localhost:9097'],
});

const sanityConfig = {
    projectId: process.env.SANITY_PROJECT_ID,
    dataset: 'production',
    apiVersion: '2024-12-21',
    useCdn: true,
    token: process.env.SANITY_TOKEN
}

const sanityClient: SanityClient = createClient(sanityConfig);

async function init() {
    const consumers = [];
    for (let i = 0; i < availableParallelism(); i++)
        consumers.push(kafka.consumer({
            groupId: 'seller-subscription-transaction',
        }));

    async function handleMessage({ message }: EachMessagePayload) {
        try {
            const { _id, subscriptionPlan } = JSON.parse(message.value.toString())
            console.log('Processing subscription plan:', subscriptionPlan)

            // First, fetch the current admin document to check existing subscription plans
            const adminDoc = await sanityClient.fetch(
                `*[_type=="admin" && _id==$adminId][0]{
                    _id,
                    subscriptionPlan[]{
                        _key,
                        transactionId,
                        orderId,
                        paymentSignature,
                        amount,
                        planSchemaList{
                            activeDate,
                            expireDate
                        }
                    }
                }`,
                { adminId: _id }
            );

            if (!adminDoc) {
                console.error(`Admin document not found for ID: ${_id}`);
                return;
            }

            // Calculate the start date for the new subscription plan
            let newPlanStartDate = new Date(); // Default to current date

            if (adminDoc.subscriptionPlan && adminDoc.subscriptionPlan.length > 0) {
                // Find the latest expiry date from existing subscription plans
                let latestExpiryDate: Date | null = null;

                for (const plan of adminDoc.subscriptionPlan) {
                    if (plan.planSchemaList?.expireDate) {
                        const expireDate = new Date(plan.planSchemaList.expireDate);
                        if (!latestExpiryDate || expireDate > latestExpiryDate) {
                            latestExpiryDate = expireDate;
                        }
                    }
                }

                // If there's a valid expiry date in the future, start the new plan after it
                if (latestExpiryDate && latestExpiryDate > new Date()) {
                    newPlanStartDate = new Date(latestExpiryDate);
                    console.log(`New subscription plan will start after existing plan expires: ${newPlanStartDate.toISOString()}`);
                } else {
                    console.log('No active subscription plans found, starting new plan immediately');
                }
            } else {
                console.log('No existing subscription plans, starting new plan immediately');
            }

            // Calculate the new plan's expiry date (assuming 30 days duration)
            const newPlanExpiryDate = new Date(newPlanStartDate);
            newPlanExpiryDate.setDate(newPlanExpiryDate.getDate() + 30);

            // Create the new subscription plan with calculated dates
            const newSubscriptionPlan = {
                _key: shortid(),
                ...subscriptionPlan,
                planSchemaList: {
                    activeDate: newPlanStartDate.toISOString(),
                    expireDate: newPlanExpiryDate.toISOString()
                }
            };

            console.log('Appending new subscription plan:', newSubscriptionPlan);

            // Append the new subscription plan
            await sanityClient
                .patch(_id)
                .append('subscriptionPlan', [newSubscriptionPlan])
                .commit();

            console.log(`Successfully added subscription plan for admin: ${_id}`);

        } catch (error) {
            console.error('Error processing subscription message:', error);
        }
    }

    for (let consumer of consumers)
        consumer.connect().then(() => {
            consumer.subscribe({ topic: 'admin-update-topic' }).then(() => {
                consumer.run({
                    eachMessage: handleMessage
                })
            })
        })

}

init();