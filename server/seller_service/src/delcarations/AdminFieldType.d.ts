export declare interface AdminFieldsType {
  _type?: string;
  _id: string;
  username: string | null | undefined;
  geoPoint?: {
    lat: number;
    lng: number;
  };
  gstin?: string;
  phone?: number;
  email: string | null | undefined;
  subscriptionPlan?: subscription[] | undefined | null;
  address: {
    pincode: string;
    county: string;
    country: string;
    state: string;
  };
}

type subscription = {
  _key?: string;            // auto-generated DB row id (returned from MySQL)
  transactionId: string;
  orderId: string;
  paymentSignature: string;
  amount?: number;
  storeAllotment: number;   // number of stores the seller can configure under this plan
  planSchemaList: {
    activeDate: Date;
    expireDate: Date;
  };
};
