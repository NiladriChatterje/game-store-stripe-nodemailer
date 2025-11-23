import { defineField, defineType } from 'sanity'

export const OrderAcceptedBySellerType = defineType({
    name: 'orderAcceptedBySeller',
    title: 'Orders Accepted By Seller',
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
            name: 'seller',
            title: 'Seller',
            type: 'reference',
            to: [{ type: 'admin' }],
            validation: rule => rule.required()
        }),
        defineField({
            name: 'products',
            title: 'Products Assigned',
            type: 'array',
            of: [
                {
                    type: 'object',
                    fields: [
                        defineField({
                            name: 'product',
                            type: 'reference',
                            to: [{ type: 'product' }],
                            validation: rule => rule.required()
                        }),
                        defineField({
                            name: 'quantity',
                            type: 'number',
                            validation: rule => rule.required().positive().min(1)
                        }),
                        defineField({
                            name: 'price',
                            type: 'number',
                            validation: rule => rule.required().positive()
                        })
                    ]
                }
            ],
            validation: rule => rule.required()
        }),
        defineField({
            name: 'status',
            title: 'Seller Order Status',
            type: 'string',
            validation: rule => rule.required(),
            description: 'Status of order from seller perspective: pending | accepted | rejected | processing | ready_to_ship',
            options: {
                list: [
                    { title: 'Pending', value: 'pending' },
                    { title: 'Accepted', value: 'accepted' },
                    { title: 'Rejected', value: 'rejected' },
                    { title: 'Processing', value: 'processing' },
                    { title: 'Ready to Ship', value: 'ready_to_ship' }
                ],
                layout: 'radio'
            },
            initialValue: 'pending'
        }),
        defineField({
            name: 'totalAmount',
            title: 'Total Amount for Seller',
            type: 'number',
            validation: rule => rule.required().positive(),
            description: 'Total amount seller needs to fulfill for this order'
        }),
        defineField({
            name: 'acceptedAt',
            title: 'Accepted At',
            type: 'datetime',
            description: 'When the seller accepted the order'
        }),
        defineField({
            name: 'rejectionReason',
            title: 'Rejection Reason',
            type: 'string',
            description: 'Reason if seller rejects the order'
        }),
        defineField({
            name: 'notes',
            title: 'Seller Notes',
            type: 'text',
            description: 'Any additional notes from the seller'
        })
    ]
});
