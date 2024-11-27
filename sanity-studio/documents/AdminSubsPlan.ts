import { defineField, defineType } from "sanity";

export const plansObject = defineType({
    name: 'plans',
    type: 'object',
    fields: [
        defineField({
            name: 'activeDate',
            title: 'Active Date',
            type: 'datetime',
        }),
        defineField({
            name: 'activeDays',
            title: 'Active Days',
            type: 'number',
        }),
        defineField({
            name: 'expirePlan',
            title: 'Plan Expiration',
            type: 'datetime',
            initialValue: new Date().toISOString()
        })]
})

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
            name: 'isPlanActive',
            title: 'Plan Active',
            type: 'boolean',
        }),
        defineField({
            name: 'planSchemeList',
            type: 'array',
            of: [{
                type: 'plans'
            }
            ]
        })
    ]
})