import { defineField } from "sanity";
export const UserType = defineField({
    name: 'user',
    title: 'User',
    type: 'document',
    fields: [
        defineField({
            name: 'username',
            title: 'Username',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'phone',
            title: 'Phone',
            type: 'number',
            // validation: rule => rule.required().min(1000000000).max(9999999999)
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
        }),
        defineField({
            name: 'cart',
            title: 'cart',
            type: 'array',
            of: [{
                type: 'object',
                name: 'product_ref -> quantity',
                fields: [
                    defineField(
                        {
                            name: "product_reference",
                            type: 'reference',
                            to: [{ type: 'product' }],
                        }
                    ),
                    defineField({
                        name: 'cart_quantity',
                        type: 'number'
                    })
                ]
            }]
        })
    ]
})