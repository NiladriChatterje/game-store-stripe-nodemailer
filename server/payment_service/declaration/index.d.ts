export interface Subscription {
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
