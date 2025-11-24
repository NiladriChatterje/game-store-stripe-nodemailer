import { defineField, defineType } from 'sanity'

export const RefundAuditType = defineType({
    name: 'refundAudit',
    title: 'Refund Audit Trail',
    type: 'document',
    fields: [
        defineField({
            name: 'order',
            title: 'Order Reference',
            type: 'reference',
            to: [{ type: 'order' }],
            validation: rule => rule.required()
        }),
        defineField({
            name: 'customer',
            title: 'Customer Reference',
            type: 'reference',
            to: [{ type: 'user' }],
            validation: rule => rule.required()
        }),
        defineField({
            name: 'originalAmount',
            title: 'Original Amount',
            type: 'number',
            validation: rule => rule.required().positive(),
            description: 'Total amount of the original order'
        }),
        defineField({
            name: 'fulfilledAmount',
            title: 'Fulfilled Amount',
            type: 'number',
            description: 'Amount that was successfully fulfilled'
        }),
        defineField({
            name: 'refundAmount',
            title: 'Refund Amount',
            type: 'number',
            validation: rule => rule.required().positive(),
            description: 'Amount refunded to customer'
        }),
        defineField({
            name: 'reason',
            title: 'Refund Reason',
            type: 'string',
            validation: rule => rule.required(),
            description: 'Reason for the refund'
        }),
        defineField({
            name: 'razorpayRefundId',
            title: 'Razorpay Refund ID',
            type: 'string',
            description: 'Unique refund ID from Razorpay'
        }),
        defineField({
            name: 'status',
            title: 'Refund Status',
            type: 'string',
            validation: rule => rule.required(),
            options: {
                list: [
                    { title: 'Pending', value: 'pending' },
                    { title: 'Processing', value: 'processing' },
                    { title: 'Completed', value: 'completed' },
                    { title: 'Failed', value: 'failed' }
                ],
                layout: 'radio'
            },
            initialValue: 'pending'
        }),
        defineField({
            name: 'errorMessage',
            title: 'Error Message',
            type: 'text',
            description: 'Error message if refund failed'
        }),
        defineField({
            name: 'processedAt',
            title: 'Processed At',
            type: 'datetime',
            validation: rule => rule.required(),
            description: 'When the refund was processed'
        }),
        defineField({
            name: 'notes',
            title: 'Notes',
            type: 'text',
            description: 'Additional notes about the refund'
        })
    ]
});
