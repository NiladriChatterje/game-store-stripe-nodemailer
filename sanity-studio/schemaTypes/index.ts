import AdminType from '../documents/AdminType'
import { ProductType } from "../documents/ProductType";
import { UserType } from '../documents/UserType';
import { productPriceType } from '../documents/ProductPriceType'
import { AddressObject } from '../documents/AddressType';
import { AdminSubsPlan, plansObject } from '../documents/AdminSubsPlan';
import { type SchemaTypeDefinition } from 'sanity';
import { RegionToProducts } from '../documents/RegionBasedProducts';

export const schemaTypes: SchemaTypeDefinition[] = [AdminType, ProductType, RegionToProducts,
    productPriceType, plansObject, ProductType, UserType, AddressObject, AdminSubsPlan]