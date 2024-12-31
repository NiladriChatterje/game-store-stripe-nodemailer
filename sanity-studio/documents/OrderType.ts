import { defineField, defineType } from 'sanity'

export const orderType = defineType({
    name: 'order',
    title: 'ordertype',
    type: 'object',
    fields: [
        defineField({
            name: 'customer',
            type: 'reference',
            to: [{ type: 'user' }]
        }),
        defineField({
            name: 'product',
            type: 'reference',
            to: [{ type: 'productType' }]
        }),
        defineField({
            name: 'qty',
            type: 'number',
            validation: rule => rule.required().positive()
        }),

    ]
});
