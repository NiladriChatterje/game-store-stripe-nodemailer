import { defineField, defineType } from "sanity";

export const ProductType = defineType({
    name: 'productStructure',
    type: 'object',
    fields: [
        defineField({
            name: 'EAC_UAC_UPC_ISBN',
            title: 'EAC_UAC_UPC_ISBN',
            type: 'array',
            description: 'To uniquely identify every product globally',
            of: [{ type: 'number' }],
            options: {
                list: ['EAC', 'UPC', 'ISBN']
            }
        }),
        defineField({
            name: 'quantity',
            title: 'Quantity',
            type: 'number'
        }),
        defineField({
            name: 'pinCode',
            title: 'PIN Code',
            type: 'number',
            validation: rule => rule.required().positive().max(999999).min(100000)
        }),
        defineField({
            name: 'pinCode',
            title: 'PIN Code',
            type: 'number',
            validation: rule => rule.required().positive().max(999999).min(100000)
        })
    ]
})