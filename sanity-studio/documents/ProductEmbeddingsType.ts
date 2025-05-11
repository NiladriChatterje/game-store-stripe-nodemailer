import { defineType, defineField } from "sanity";

export const ProductEmbeddings = defineType({
    name: 'productEmbeddings',
    type: 'document',
    fields: [
        defineField({
            name: '_id',
            type: 'string'
        }),
        defineField({
            name: 'embeddings',
            type: 'array',
            description: 'stores embedding of a product document',
            of: [{ type: 'number' }]

        })
    ]
})