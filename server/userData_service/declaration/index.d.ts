declare enum EanUpcIsbnType { EAN = "EAN", UPC = "UPC", ISBN = "ISBN", ASIN = "ASIN", GTIN = "GTIN", OTHERS = "OTHERS" }
declare enum currency { INR = "INR", YEN = "YEN", USD = "USD" }

export declare type ProductType = {
    _id: string;
    productName: string;
    category: string;
    eanUpcIsbnGtinAsinType: EanUpcIsbnType;
    eanUpcNumber: string;
    price: {
        currency: string;
        discountPercentage: number;
        pdtPrice: number
    };
    currency?: currency;
    imagesBase64?: { size: number; extension: string; base64: string }[];
    image?: File[];
    modelNumber?: string;
    productDescription: string;
    quantity: number;
    keywords: string[];
    discount: number;
    seller?: string;
};



export declare type UserType = {
    _id: string;
    username: string | null | undefined;
    geoPoint: {
        lat: number;
        lng: number;
    }
    phone?: number;
    email: string | null | undefined;
    address: {
        pincode: string;
        county: string;
        country: string;
        state: string;
    },
    cart: { _id: string; quantity: number }[]
}
