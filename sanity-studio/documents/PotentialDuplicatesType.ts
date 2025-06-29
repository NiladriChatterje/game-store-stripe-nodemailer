import { defineType, defineField } from 'sanity';

export const PotentialDuplicates = defineType({
    name: 'potentialDuplicates',
    title: 'Potential Duplicate Products',
    type: 'document',
    fields: [
        defineField({
            name: 'existingProduct',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'potentialDuplicate',
            type: 'string',
            validation: rule => rule.required()
        })
    ]
})