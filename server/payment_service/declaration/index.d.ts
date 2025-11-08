export interface Subscription {
    transactionId: string;
    orderId: string;
    paymentSignature: string;
    activePlan: number;
    amount?: number;
    planSchemaList: planSchemaList; // Fixed: Changed from planSchemeList to planSchemaList to match Sanity schema
}
interface planSchemaList {
    activeDate: Date;
    expireDate: Date;
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