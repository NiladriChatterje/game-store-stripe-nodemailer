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
            of: [{ type: 'string' }],
            options: {
                list: ['EAC', 'UPC', 'ISBN']
            }
        }),
        defineField({
            name: 'EAC_UAC_UPC_ISBN_number',
            title: 'EAC_UAC_UPC_ISBN_number',
            type: 'array',
            description: 'To uniquely identify every product globally',
            of: [{ type: 'number' }],
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
        })
    ]
})