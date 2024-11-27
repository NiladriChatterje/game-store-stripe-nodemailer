import { defineArrayMember, defineField } from "sanity";

const AdminType = defineField({
    name: 'admin',
    title: 'Admin',
    type: 'document',
    fields: [
        defineField({
            name: 'Username',
            title: 'Username',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'userID',
            title: 'USER ID',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'gstin',
            title: 'GSTIN',
            type: 'string',
            validation: rule => rule.required().max(15).min(15)
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
            name: 'Subscription',
            type: 'subscription',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'address',
            type: 'AddressObjectType'
        }),
        defineField({
            name: 'ordersServed',
            title: 'Orders Served',
            type: 'number',
            initialValue: 0,
            validation: rule => rule.min(0),
        }),
        defineField({
            name: 'inventory',
            title: 'Inventory',
            type: 'array',
            initialValue: [{}],
            of: [
                defineArrayMember({ type: 'productStructure' })
            ],
            readOnly: true
        }),
    ]
})

export default AdminType;