import AdminType from '../documents/AdminType'
import { ProductType } from "../documents/ProductType";
import { UserType } from '../documents/UserType';
import { productPriceType } from '../Objects/ProductPriceType'
import { AddressObject } from '../Objects/AddressType';
import { AdminSubsPlan, plansObject } from '../Objects/AdminSubsPlan';
import { type SchemaTypeDefinition } from 'sanity';
import { RegionToProducts } from '../documents/RegionBasedProducts';
import { OrderType } from '../documents/OrderType';
import { ShippingType } from '../documents/ShippingType';
import { ShipperType } from '../documents/ShipperType';

export const schemaTypes: SchemaTypeDefinition[] = [AdminType, RegionToProducts, OrderType,ShippingType,
    ShipperType,
    productPriceType, plansObject, ProductType, UserType, AddressObject, AdminSubsPlan]