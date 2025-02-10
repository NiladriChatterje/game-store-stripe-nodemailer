import { defineField, defineType } from "sanity";

export const AddressObject = defineType({
    name: 'AddressObjectType',
    type: 'object',
    validation: rule => rule.required(),
    fields: [
        defineField({
            name: 'pinCode',
            title: 'PIN Code',
            type: 'string',
            validation: rule => rule.required().length(6)
        }),
        defineField({
            name: 'county',
            title: 'County',
            type: 'string',
        }),
        defineField({
            name: 'country',
            title: 'Country',
            type: 'string',
        }),
        defineField({
            name: 'state',
            title: 'State',
            type: 'string',
        }),
    ]
});