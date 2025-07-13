import { defineField, defineType } from 'sanity'

export const OrderType = defineType({
    name: 'order',
    title: 'Orders',
    type: 'document',
    fields: [
        defineField({
            name: 'customer',
            type: 'reference',
            to: [{ type: 'user' }]
        }),
        defineField({
            name: 'product',
            type: 'array',
            of: [{ type: 'reference', to: [{ type: 'product' }] }]

        }),
        defineField({
            name: 'quantity',
            type: 'number',
            validation: rule => rule.required().positive().min(1)
        }),
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
            name: 'amount',
            title: 'Amount',
            type: 'number',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'status',
            type: 'string',
            validation: rule => rule.required(),
            description: 'status of the order if its orderPlaced | dispatched | shipping | shipped',
            options: {
                list: ['orderPlaced', 'dispatched', 'shipping', 'shipped'],
                layout: 'radio'
            },
            initialValue: 'orderPlaced'
        }),

    ]
});
