import AdminType from '../documents/AdminType'
import { pair, ProductType } from "../documents/ProductType";
import { UserType } from '../documents/UserType';
import { productPriceType } from '../Objects/ProductPriceType'
import { AddressObject } from '../Objects/AddressType';
import { AdminSubsPlan, plansObject } from '../Objects/AdminSubsPlan';
import { type SchemaTypeDefinition } from 'sanity';
import { RegionToProducts } from '../documents/seller_product_details';
import { OrderType } from '../documents/OrderType';
import { ShippingType } from '../documents/ShippingType';
import { ShipperType } from '../documents/ShipperType';
import { ProductEmbeddings } from '../documents/ProductEmbeddingsType';
import { PotentialDuplicates } from '../documents/PotentialDuplicatesType';

export const schemaTypes: SchemaTypeDefinition[] = [AdminType, RegionToProducts, OrderType, ShippingType,
    ShipperType, ProductEmbeddings, pair, PotentialDuplicates,
    productPriceType, plansObject, ProductType, UserType, AddressObject, AdminSubsPlan]