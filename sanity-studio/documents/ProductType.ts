import { defineField, defineType } from 'sanity'

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
      name: 'imagesBase64',
      title: 'Image',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            defineField({
              name: 'size',
              type: 'number',
            }),
            defineField({
              name: 'base64',
              type: 'string',
            }),
            defineField({
              name: 'extension',
              type: 'string',
            }),
          ],
        },
      ],
      description: 'Product Images',
    }),
    defineField({
      name: 'eanUpcIsbnGtinAsinType',
      title: 'EAN_UPC_ISBN_GTIN Type',
      type: 'string',
      description: 'Select Type of UID',
      options: {
        list: ['EAN', 'UPC', 'ISBN', 'ASIN', 'GTIN', 'OTHERS'],
        layout: 'radio',
      },
    }),

    defineField({
      name: 'eanUpcIsbnGtinAsinNumber',
      title: 'EAN_UPC_ISBN_GTIN Number',
      type: 'string',
      description: 'To uniquely identify every product globally',
    }),
    defineField({
      name: 'quantity',
      title: 'Quantity',
      type: 'number',
      validation: (rule) => rule.positive(),
    }),
    defineField({
      name: 'category',
      title: 'Category',
      type: 'string',
      validation: (rule) => rule.required(),
      options: {
        list: ["clothing", "food", "Groceries", "gadgets", "home-goods", "toys",],
        layout: 'radio'
      }
    }),
    defineField({
      name: 'modelNumber',
      title: 'Model Number',
      type: 'string',
      hidden: ({ parent }) => !(parent?.category == 'gadgets')
    }),
    defineField({
      name: 'seller',
      title: 'Seller',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'admin' }] }],
      validation: (rule) => rule.required().min(1),
    }),
    defineField({
      name: 'productDescription',
      title: 'Product Description',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'price',
      title: 'Price',
      type: 'productPriceType',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'keywords',
      title: 'Keywords',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'improves search engine',
      options: {
        layout: 'tags',
      },
    }),
  ],
})
