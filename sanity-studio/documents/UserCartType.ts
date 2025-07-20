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
            title: 'cart',
            type: 'array',
            of: [{
                type: 'object',
                name: 'product_ref -> quantity',
                fields: [
                    defineField(
                        {
                            name: "product_reference",
                            type: 'reference',
                            to: [{ type: 'product' }],
                        }
                    ),
                    defineField({
                        name: 'cart_quantity',
                        type: 'number'
                    })
                ]
            }]
        })
    ]
})