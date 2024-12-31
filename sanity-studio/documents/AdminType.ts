import { defineField, defineType } from "sanity";

const AdminType = defineType({
    name: 'admin',
    title: 'Admin',
    type: 'document',
    fields: [
        defineField({
            name: 'username',
            title: 'Username',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'adminId',
            title: 'Admin ID',
            type: 'string',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'gstin',
            title: 'GSTIN',
            type: 'string',
            validation: rule => rule.max(15).min(15)
        }),
        defineField({
            name: 'phone',
            title: 'Phone',
            type: 'number',
            validation: rule => rule.min(1000000000).max(9999999999)
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
            name: 'subscriptionPlan',
            title: 'Subscription',
            type: 'array',
            of: [
                { type: 'subscription' }
            ],
            validation: rule => rule.warning('Must be updated')
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
            name: 'productReferenceAfterListing',
            title: 'Product Reference',
            type: 'array',
            of: [{ type: 'reference', to: [{ type: 'productType' }] }]
        }),
    ]
})

export default AdminType;