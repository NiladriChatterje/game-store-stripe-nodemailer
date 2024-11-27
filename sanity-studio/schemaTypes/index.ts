import AdminType from '../documents/AdminType'
import { ProductType } from "../documents/ProductType";
import { UserType } from '../documents/UserType';
import { AddressObject } from '../documents/AddressType';
import { AdminSubsPlan, plansObject } from '../documents/AdminSubsPlan';

export const schemaTypes = [AdminType, plansObject, ProductType, UserType, AddressObject, AdminSubsPlan]
