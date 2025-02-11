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
            of: [{
                type: 'reference',
                to: { type: 'productType' }
            }]
        }),
        defineField({
            name: 'qty',
            type: 'number',
            validation: rule => rule.required().positive().min(1)
        }),
        defineField({
            name: 'status',
            type: 'string',
            validation: rule => rule.required(),
            description: 'status of the order if its orderPlaced | dispatched | shipping | shipped',
            options: {
                list: ['orderPlaced', 'dispatched', 'shipping', 'shipped'],
                layout: 'radio'
            }
        }),

    ]
});
