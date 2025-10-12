export declare interface AdminFieldsType {
  _type?: string;
  _id: string;
  username: string | null | undefined;
  geoPoint: {
    lat: number;
    lng: number;
  };
  gstin?: string;
  phone?: number;
  adminId: string | null | undefined;
  email: string | null | undefined;
  SubscriptionPlan?: subscription[] | undefined | null;
  address: {
    pincode: string;
    county: string;
    country: string;
    state: string;
  };
}

type subscription = {
  transactionId: string;
  orderId: string;
  paymentSignature: string;
  activePlan: number;
  planSchemeList: planSchemeList;
};

interface planSchemeList {
  activeDate: Date;
  expireDate: Date;
}
