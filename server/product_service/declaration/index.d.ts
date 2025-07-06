declare enum EanUpcIsbnType { EAN = "EAN", UPC = "UPC", ISBN = "ISBN", ASIN = "ASIN", GTIN = "GTIN", OTHERS = "OTHERS" }
declare enum currency { INR = "INR", YEN = "YEN", USD = "USD" }

export declare type ProductType = {
  _id: string;
  productName: string;
  category: string;
  eanUpcIsbnGtinAsinType: EanUpcIsbnType;
  eanUpcNumber: string;
  pincode: string;
  price: {
    currency: string;
    discountPercentage: number;
    pdtPrice: number
  };
  geoPoint?: {
    lat: number;
    lng: number
  }
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
