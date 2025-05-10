import { defineType, defineField } from "sanity";

export const ProductEmbeddings = defineType({
    name: 'productEmbeddings',
    type: 'document',
    fields: [
        defineField({
            name: '_id',
            type: 'string'
        })
    ]
})