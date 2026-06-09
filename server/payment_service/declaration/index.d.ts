export interface Subscription {
    transactionId: string;
    orderId: string;
    paymentSignature: string;
    amount?: number;
    storeAllotment: number;
    planSchemaList: {
        activeDate: Date;
        expireDate: Date;
    };
}

export interface customerOrderType {
    customer: string;
    product: string,
    transactionId: string,
    orderId: string,
    paymentSignature: string,
    amount: number,
    quantity: number,
    pincode: number
}