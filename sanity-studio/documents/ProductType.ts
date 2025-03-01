import { defineField, defineType } from "sanity";

export const ProductType = defineType({
    name: 'product',
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
                type: 'string',
            }],
            description: 'Product Images',

        }),
        defineField({
            name: 'eanUpcIsbnGtinAsinType',
            title: 'EAN_UPC_ISBN_GTIN Type',
            type: 'string',
            description: 'Select Type of UID',
            options: {
                list: ['EAN', 'UPC', 'ISBN', 'ASIN', 'GTIN', 'OTHERS'],
                layout: 'radio'
            }
        }),

        defineField({
            name: 'eanUpcIsbnGtinAsinNumber',
            title: 'EAN_UPC_ISBN_GTIN Number',
            type: 'string',
            description: 'To uniquely identify every product globally',
        }),
        defineField({
            name: 'modelNumber',
            title: 'Model Number',
            type: 'string',
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
            type: 'array',
            of: [{ type: 'reference', to: [{ type: 'admin' }] }],
            validation: rule => rule.required().min(1)
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
    ],
})