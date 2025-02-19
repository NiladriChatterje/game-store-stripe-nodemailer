import {defineType,defineField} from 'sanity';

export const ShippingType = defineType({
    name:'shippingType',
    title:'Shipping',
    type:'document',
    fields:[
        defineField({
            name:'productDocId',
            title:'Product',
            type:'reference',
            to:{type:'product'},
            validation:rule=>rule.required()
        }),
        defineField({
            name:'userDocId',
            title:'User',
            type:'reference',
            to:{type:'user'},
            validation:rule=>rule.required()
        }),
        defineField({
            name:'shipperId',
            title:'Shipper',
            type:'reference',
            to:{type:'shipper'},
        }),
    ]
})