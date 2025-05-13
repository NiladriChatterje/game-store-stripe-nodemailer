import { defineType, defineField } from "sanity";

export const ProductEmbeddings = defineType({
    name: 'productEmbeddings',
    type: 'document',
    fields: [
        // defineField({
        //     name: 'product_id',
        //     title: 'product_id',
        //     type: 'string',
        // }),
        defineField({
            name: 'embeddings',
            title: 'embeddings',
            type: 'array',
            description: 'stores embedding of a product document',
            of: [{ type: 'number' }]
        })
    ]
})