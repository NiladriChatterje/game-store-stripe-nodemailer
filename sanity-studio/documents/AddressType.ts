import { defineField, defineType } from "sanity";

export const AddressObject = defineType({
    name: 'AddressObjectType',
    type: 'object',
    validation: rule => rule.required(),
    fields: [
        defineField({
            name: 'pinCode',
            title: 'PIN Code',
            type: 'number',
            validation: rule => rule.required().positive().max(999999).min(100000)
        }),
        defineField({
            name: 'region',
            title: 'Region',
            type: 'string',
        }),
        defineField({
            name: 'country',
            title: 'Country',
            type: 'string',
        }),
        defineField({
            name: 'locality',
            title: 'Locality',
            type: 'string',
        }),
    ]
});