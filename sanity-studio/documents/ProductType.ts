import { defineField, defineType } from "sanity";

export const ProductType = defineType({
    name: 'productStructure',
    title: 'Product',
    type: 'document',
    fields: [
        defineField({
            name: 'productName',
            title: 'Product Name',
            type: 'string',
            description: 'Name of the Product',
        }),
        defineField({
            name: 'image',
            title: 'Image',
            type: 'array',
            of: [{
                type: 'image',
                options: {
                    hotspot: true
                }
            }],
            description: 'Product Images',

        }),
        defineField({
            name: 'EAC_UAC_UPC_ISBN',
            title: 'EAC_UAC_UPC_ISBN',
            type: 'string',
            description: 'Select Type of UID',
            options: {
                list: ['EAC', 'UPC', 'ISBN', 'ASIN', 'OTHERS'],
                layout: 'radio'
            }
        }),
        defineField({
            name: 'EAC_UAC_UPC_ISBN_number',
            title: 'EAC_UAC_UPC_ISBN_number',
            type: 'number',
            description: 'To uniquely identify every product globally',
        }),
        defineField({
            name: 'quantity',
            title: 'Quantity',
            type: 'number',
            validation: rule => rule.positive()
        }),
        defineField({
            name: 'seller',
            title: 'Seller',
            type: 'reference',
            to: [{ type: 'admin' }]
        }),
        defineField({
            name: 'productDescription',
            title: 'Product Description',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'price',
            title: 'Price',
            type: 'productPriceType',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'keywords',
            title: 'Keywords',
            type: 'array',
            of: [{ type: 'string' }],
            description: 'improves search engine',
            options: {
                layout: 'tags'
            }
        })
    ]
})