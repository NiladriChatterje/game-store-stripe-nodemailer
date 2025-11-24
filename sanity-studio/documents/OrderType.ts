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
        defineField({
            name: 'fulfilledQuantity',
            title: 'Fulfilled Quantity',
            type: 'number',
            description: 'Actual quantity that could be fulfilled (for partial orders)',
            initialValue: undefined
        }),
        defineField({
            name: 'refundAmount',
            title: 'Refund Amount',
            type: 'number',
            description: 'Amount to be refunded for unfulfilled items'
        }),
        defineField({
            name: 'refundStatus',
            title: 'Refund Status',
            type: 'string',
            description: 'Status of refund: pending | processing | completed | failed',
            options: {
                list: [
                    { title: 'Pending', value: 'pending' },
                    { title: 'Processing', value: 'processing' },
                    { title: 'Completed', value: 'completed' },
                    { title: 'Failed', value: 'failed' }
                ]
            }
        }),
        defineField({
            name: 'partialFulfillmentReason',
            title: 'Partial Fulfillment Reason',
            type: 'text',
            description: 'Reason why the order was only partially fulfilled'
        }),
        defineField({
            name: 'razorpayRefundId',
            title: 'Razorpay Refund ID',
            type: 'string',
            description: 'Refund ID from Razorpay payment gateway'
        })

    ]
});
