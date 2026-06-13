export declare interface ShipperPayload {
  _id: string;
  username: string;
  email: string;
  phone?: number;
  address?: {
    pincode?: string;
    county?: string;
    country?: string;
    state?: string;
  };
}

/** Payload sent to shipper-create-topic */
export declare interface CreateShipperConsumerPayload {
  _id: string;
  username: string;
  email: string;
}

/** Payload received from update-shipper-topic */
export declare interface UpdateShipperConsumerPayload {
  _id: string;
  shippername?: string;
  phone?: number;
  email?: string;
  geoPoint?: { lat?: number; lng?: number };
  address?: {
    pincode?: string;
    county?: string;
    country?: string;
    state?: string;
  };
}
