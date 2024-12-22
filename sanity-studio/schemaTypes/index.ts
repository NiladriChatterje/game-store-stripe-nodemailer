import AdminType from '../documents/AdminType'
import { ProductType } from "../documents/ProductType";
import { UserType } from '../documents/UserType';
import { productPriceType } from '../documents/ProductPriceType'
import { AddressObject } from '../documents/AddressType';
import { AdminSubsPlan, plansObject } from '../documents/AdminSubsPlan';
import { type SchemaTypeDefinition } from 'sanity';

export const schemaTypes: SchemaTypeDefinition[] = [AdminType, productPriceType, plansObject, ProductType, UserType, AddressObject, AdminSubsPlan]