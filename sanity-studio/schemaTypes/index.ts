import AdminType from '../documents/AdminType'
import { ProductType } from "../documents/ProductType";
import { UserType } from '../documents/UserType';
import { productPriceType } from '../documents/ProductPriceType'
import { AddressObject } from '../documents/AddressType';
import { AdminSubsPlan, plansObject } from '../documents/AdminSubsPlan';

export const schemaTypes = [AdminType, productPriceType, plansObject, ProductType, UserType, AddressObject, AdminSubsPlan]