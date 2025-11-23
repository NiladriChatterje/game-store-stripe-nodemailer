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
        //reason is that after the order has been placed,
        //all products might not be available from the same seller
        //say 4 products is stocked by same seller but the other 
        // 2 might be from different sellers
        defineField({
            name: 'product',
            type: 'array',
            of: [{
                type: 'object',
                fields: [
                    defineField({
                        name: 'seller',
                        type: 'reference',
                        to: [{ type: 'admin' }],
                        validation: rule => rule.required()
                    }),
                    defineField({
                        name: 'products',
                        type: 'array',
                        of: [{ type: 'reference', to: [{ type: 'product' }] }],
                        validation: rule => rule.required()
                    })
                ]
            }]
        }),
        defineField({
            name: 'shipperId',
            title: 'Shipper',
            type: 'reference',
            to: { type: 'shipper' },
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
