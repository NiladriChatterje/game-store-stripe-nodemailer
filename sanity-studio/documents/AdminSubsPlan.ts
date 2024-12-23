import { defineField, defineType } from "sanity";

export const plansObject = defineType({
    name: 'plans',
    type: 'object',
    fields: [
        defineField({
            name: 'activeDate',
            title: 'Active Date',
            type: 'datetime',
            initialValue: new Date().toISOString(),
            validation: rule => rule.required()

        }),
        defineField({
            name: 'activeDays',
            title: 'Active Days',
            type: 'number',
            validation: rule => rule.required()

        }),
        defineField({
            name: 'expireDate',
            title: 'Plan Expiration',
            type: 'datetime',
            initialValue: () => {
                const date = new Date();
                date.setDate(date.getDate() + 30);
                return date.toISOString();
            },
            validation: rule => rule.required().custom((context) => {
                return true;
            })
        })]
})

export const AdminSubsPlan = defineType({
    name: 'subscription',
    type: 'object',
    title: 'Subscription',
    fields: [
        defineField({
            name: 'transactionId',
            title: 'Transaction ID',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'orderId',
            title: 'Order ID',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'paymentSignature',
            title: 'Payment Signature',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'activePlan',
            title: 'Active Plan',
            type: 'number',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'isPlanActive',
            title: 'Plan Active',
            type: 'boolean',
            initialValue: false,
            validation: rule => rule.required()
        }),
        defineField({
            name: 'planSchemeList',
            title: 'Plans',
            type: 'plans'
        })
    ]
})