export declare interface AdminFieldsType {
    document_id: string;
    username: string | null | undefined;
    geoPoint: {
      lat: number;
      lng: number;
    }
    phone?: number;
    adminId: string | null | undefined;
    email: string | null | undefined;
    SubscriptionPlan?: subscription[] | undefined | null;
    address: {
      pinCode: string;
      county: string;
      country: string;
      state: string;
    }
  }
  
  type subscription = {
    transactionId: string;
    orderId: string;
    paymentSignature: string;
    activePlan: number;
    planSchemeList: planSchemeList;
  }
  
  interface planSchemeList {
    activeDate: Date;
    expireDate: Date;
  }
  