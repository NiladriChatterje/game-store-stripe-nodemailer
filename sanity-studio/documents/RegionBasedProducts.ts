import { defineArrayMember, defineField, defineType } from "sanity";

export const RegionToProducts = defineType({
    name: 'regionToProducts',
    title: 'Region-Products',
    type: 'document',
    fields: [
        defineField({
            name: 'region',
            type: 'string',
            title: 'Region'
        }),
        defineField({
            name: 'productList',
            title: 'Product List',
            type: 'array',
            of: [defineArrayMember({ name: 'product', type: 'reference',to:{type:'product'} })]
        })
    ]
})