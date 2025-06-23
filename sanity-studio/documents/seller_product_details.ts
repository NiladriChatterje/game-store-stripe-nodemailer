import { defineArrayMember, defineField, defineType } from "sanity";

export const RegionToProducts = defineType({
    name: 'seller_product_details',
    title: 'seller_product_details',
    type: 'document',
    fields: [
        defineField({
            name: 'product_id',
            type: 'string',
            title: 'product_id',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'seller_id',
            title: 'seller_id',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'pincode',
            title: 'pincode',
            type: 'string',
            validation: rule => rule.required().length(6)
        }),
        defineField({
            name: 'quantity',
            title: 'quantity',
            type: 'number',
            validation: rule => rule.required()
        }),

    ]
})