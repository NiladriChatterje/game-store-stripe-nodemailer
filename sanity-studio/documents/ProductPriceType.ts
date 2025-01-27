import { defineType, defineField } from "sanity";

const currency = ['INR', 'USD', 'YEN']
export const productPriceType = defineType({
    name: 'productPriceType',
    type: 'object',
    fields: [
        defineField({
            name: 'currency',
            title: 'Currency',
            type: 'string',
            validation: rule => rule.required().length(3),
            options: {
                list: currency,
                layout: 'radio'
            }

        }),
        defineField({
            name: "pdtPrice",
            title: 'product Price',
            type: 'number',

        }),
        defineField({
            name: "discountPercentage",
            title: 'Discount %',
            type: 'number',
            validation: rule => rule.positive().max(50),
            initialValue: 0
        })
    ]
})