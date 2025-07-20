import { defineField, defineType } from "sanity";

export const UserCartType = defineType({
    name: 'user_cart',
    title: 'User Cart',
    type: 'document',
    fields: [
        defineField({
            name: 'user_id',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'cart',
            type: 'array',
            of: [{ type: 'reference', to: [{ type: 'product' }] }]
        })
    ]
})