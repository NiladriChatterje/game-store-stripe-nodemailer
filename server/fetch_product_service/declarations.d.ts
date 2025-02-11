export declare type ProductType = {
    _id?: string;
    productName: string;
    category: string;
    eanUpcIsbnGtinAsinType: EanUpcIsbnType;
    eanUpcNumber: string;
    price: number;
    currency?: currency;
    imagesBase64?: { size: number; extension: string; base64: string }[];
    image?: FileList;
    modelNumber?: string;
    seller: string;
    productDescription: string;
    quantity: number;
    keywords: string[];
    discount: number;
    seller?: string[]
}
