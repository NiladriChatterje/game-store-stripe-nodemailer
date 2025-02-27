import { defineField } from "sanity";
export const ShipperType = defineField({
    name: 'shipper',
    title: 'Shipper',
    type: 'document',
    fields: [
        defineField({
            name: 'shippername',
            title: 'Shippername',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'phone',
            title: 'Phone',
            type: 'number',
            validation: rule => rule.required().min(1000000000).max(9999999999)
        }),
        defineField({
            name: 'email',
            title: 'Email',
            type: 'string',
            validation: rule => rule.required().email()
        }),
        defineField({
            name: 'geoPoint',
            type: 'geopoint',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'address',
            title: 'Address',
            type: 'AddressObjectType'
        })
    ]
})