import AdminType from '../documents/AdminType'
import { ProductType } from "../documents/ProductType";
import { UserType } from '../documents/UserType';
import { productPriceType } from '../documents/ProductPriceType'
import { AddressObject } from '../documents/AddressType';
import { AdminSubsPlan, plansObject } from '../documents/AdminSubsPlan';
import { type SchemaTypeDefinition } from 'sanity';
import { ProductType } from '../documents/ProductType';

export const schemaTypes: SchemaTypeDefinition[] = [AdminType, ProductType,
    productPriceType, plansObject, ProductType, UserType, AddressObject, AdminSubsPlan]