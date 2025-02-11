import AdminType from '../documents/AdminType'
import { ProductType } from "../documents/ProductType";
import { UserType } from '../documents/UserType';
import { productPriceType } from '../Objects/ProductPriceType'
import { AddressObject } from '../Objects/AddressType';
import { AdminSubsPlan, plansObject } from '../Objects/AdminSubsPlan';
import { type SchemaTypeDefinition } from 'sanity';
import { RegionToProducts } from '../documents/RegionBasedProducts';
import { OrderType } from '../documents/OrderType';

export const schemaTypes: SchemaTypeDefinition[] = [AdminType, RegionToProducts, OrderType,
    productPriceType, plansObject, ProductType, UserType, AddressObject, AdminSubsPlan]