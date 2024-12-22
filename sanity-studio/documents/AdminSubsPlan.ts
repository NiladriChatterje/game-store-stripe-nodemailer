import { defineField, defineType } from "sanity";

export const plansObject = defineType({
    name: 'plans',
    type: 'object',
    fields: [
        defineField({
            name: 'activeDate',
            title: 'Active Date',
            type: 'datetime',
            validation: rule => rule.required()

        }),
        defineField({
            name: 'activeDays',
            title: 'Active Days',
            type: 'number',
            validation: rule => rule.required()

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
            validation: rule => rule.required()
        }),
        defineField({
            name: 'activePlan',
            title: 'Active Plan',
            type: 'number',
            validation: rule => rule.required()
        }),
        defineField({
            name: 'isPlanActive',
            title: 'Plan Active',
            type: 'boolean',
            initialValue: false,
            validation: rule => rule.required()
        }),
        defineField({
            name: 'planSchemeList',
            title: 'Plans',
            type: 'plans'
        })
    ]
})