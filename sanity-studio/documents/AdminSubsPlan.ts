import { defineField, defineType } from "sanity";

export const AdminSubsPlan = defineType({
    name: 'subscription',
    type: 'object',
    title: 'Subscription',
    fields: [
        defineField({
            name: 'transactionID',
            title: 'Transaction ID',
            type: 'string',

        }),
        defineField({
            name: 'activePlan',
            title: 'Active Plan',
            type: 'number',
        }),
        defineField({
            name: 'activeDate',
            title: 'Active Date',
            type: 'datetime',
        }),
        defineField({
            name: 'expirePlan',
            title: 'Plan Expiration',
            type: 'datetime',
            initialValue: new Date().toISOString()
        })
    ]
})