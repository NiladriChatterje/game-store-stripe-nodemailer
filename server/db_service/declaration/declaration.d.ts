export declare interface productType {
    productName: string;
    imagesBase64: { extension: string; base64: string }[];
    eanUpcIsbnGtinAsinType: EanUpcIsbn;
    eanUpcIsbnGtinAsinNumber: string;
    modelNumber?: string;
    quantity: number;
    seller: string[];//type will be adminType
    price: productPriceType;
    keywords: string[]
}