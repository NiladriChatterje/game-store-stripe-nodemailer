# 🛠️ ORDER FLOW - CODE FIXES

## FIX 1: Create Order Document in Kafka Consumer

**File:** `kafka-consumers/src/AfterOrderPlaceConsumer.ts`
**Location:** After line 127 (after seller inventory update)

### Current Code (BROKEN):
```typescript
const result = await sanityClient
    .patch(productPayload.product)
    .insert('replace',
        `quantity[pincode=="${productPayload.pincode}"]`, [{
            pincode: productPayload.pincode,
            quantity: Math.max(getQtyOnPincode?.quantityObj.quantity - productPayload.quantity, 0),
            _key: uuid()
        }]
    )
    .commit();

await sanityClient.createOrReplace({
    _id: seller_quantity._id,
    _type: 'seller_product_details',
    seller_id: seller_quantity?.seller,
    product_id: productPayload.product,
    pincode: productPayload.pincode,
    quantity: (seller_quantity?.quantity ?? 0) - productPayload.quantity,
    geoPoint: {
        lat: productPayload?.geoPoint.lat,
        lng: productPayload?.geoPoint.lng
    }
})

consumer.commitOffsets([
    { topic, partition, offset: message.offset },
]);
```

### Fixed Code (ADD AFTER seller inventory update):
```typescript
const result = await sanityClient
    .patch(productPayload.product)
    .insert('replace',
        `quantity[pincode=="${productPayload.pincode}"]`, [{
            pincode: productPayload.pincode,
            quantity: Math.max(getQtyOnPincode?.quantityObj.quantity - productPayload.quantity, 0),
            _key: uuid()
        }]
    )
    .commit();

await sanityClient.createOrReplace({
    _id: seller_quantity._id,
    _type: 'seller_product_details',
    seller_id: seller_quantity?.seller,
    product_id: productPayload.product,
    pincode: productPayload.pincode,
    quantity: (seller_quantity?.quantity ?? 0) - productPayload.quantity,
    geoPoint: {
        lat: productPayload?.geoPoint.lat,
        lng: productPayload?.geoPoint.lng
    }
})

// ✅ ADD THIS SECTION TO CREATE ORDER DOCUMENT
const orderData = {
    _id: uuid(), // Generate unique order ID
    _type: 'order',
    customer: { _ref: productPayload.customer },
    product: [{ _ref: productPayload.product }],
    quantity: productPayload.quantity,
    transactionId: productPayload.transactionId,
    orderId: productPayload.orderId,
    paymentSignature: productPayload.paymentSignature,
    amount: productPayload.amount,
    status: 'orderPlaced',
    _createdAt: new Date().toISOString()
};

console.log('Creating order document:', orderData);
const createdOrder = await sanityClient.createOrReplace(orderData);
console.log('Order created successfully:', createdOrder._id);

consumer.commitOffsets([
    { topic, partition, offset: message.offset },
]);
```

---

## FIX 2: Add Error Handling in Kafka Consumer

**File:** `kafka-consumers/src/AfterOrderPlaceConsumer.ts`
**Location:** Lines 130-132 (catch block)

### Current Code (BROKEN):
```typescript
catch (error: Error | any) {

}
```

### Fixed Code:
```typescript
catch (error: Error | any) {
    console.error('❌ Failed to process order message:', {
        error: error?.message,
        stack: error?.stack,
        payload: message.value.toString()
    });
    
    // Mark message as processed even on error to avoid infinite loop
    // In production, push to dead-letter topic for manual review
    try {
        consumer.commitOffsets([
            { topic, partition, offset: message.offset },
        ]);
    } catch (commitError) {
        console.error('Failed to commit offset:', commitError);
    }
}
```

---

## FIX 3: Add Order Retrieval Endpoints

**File:** `server/payment_service/src/index.ts`
**Location:** Add after the existing `/seller-subscription` endpoint (around line 160)

### New Endpoints to Add:

```typescript
// Get all orders for a user
app.get('/user-orders/:userId',
    verifyClerkToken,
    async (req: Request<{ userId: string }>, res: Response) => {
        try {
            const orders = await sanityClient.fetch(`
                *[_type=="order" && customer._ref == $userId] {
                    _id,
                    customer->{
                        _id,
                        username,
                        email,
                        address,
                        phone
                    },
                    product[]->{
                        _id,
                        productName,
                        price,
                        imagesBase64
                    },
                    quantity,
                    transactionId,
                    orderId,
                    paymentSignature,
                    amount,
                    status,
                    _createdAt
                } | order(_createdAt desc)
            `, { userId: req.params.userId });
            
            console.log(`Fetched ${orders.length} orders for user ${req.params.userId}`);
            res.status(200).json(orders);
        } catch (error: Error | any) {
            console.error('Error fetching user orders:', error);
            res.status(500).json({ error: error.message });
        }
    }
);

// Get single order by ID
app.get('/order/:orderId',
    verifyClerkToken,
    async (req: Request<{ orderId: string }>, res: Response) => {
        try {
            const order = await sanityClient.fetch(`
                *[_type=="order" && _id == $orderId][0] {
                    _id,
                    customer->{
                        _id,
                        username,
                        email,
                        phone,
                        address,
                        geoPoint
                    },
                    product[]->{
                        _id,
                        productName,
                        price,
                        imagesBase64,
                        productDescription
                    },
                    quantity,
                    transactionId,
                    orderId,
                    paymentSignature,
                    amount,
                    status,
                    _createdAt,
                    expectedDelivery
                }
            `, { orderId: req.params.orderId });
            
            if (!order) {
                res.status(404).json({ error: 'Order not found' });
                return;
            }
            
            res.status(200).json(order);
        } catch (error: Error | any) {
            console.error('Error fetching order:', error);
            res.status(500).json({ error: error.message });
        }
    }
);

// Update order status (for shipper/admin)
app.put('/order/:orderId/status',
    verifyClerkToken,
    async (req: Request<{ orderId: string }, {}, { status: string; expectedDelivery?: string }>, res: Response) => {
        try {
            const { status, expectedDelivery } = req.body;
            
            // Validate status
            const validStatuses = ['orderPlaced', 'dispatched', 'shipping', 'shipped'];
            if (!validStatuses.includes(status)) {
                res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
                return;
            }
            
            const updateData: any = { status };
            if (expectedDelivery) {
                updateData.expectedDelivery = expectedDelivery;
            }
            
            const updatedOrder = await sanityClient
                .patch(req.params.orderId)
                .set(updateData)
                .commit();
            
            console.log(`Order ${req.params.orderId} status updated to ${status}`);
            res.status(200).json(updatedOrder);
        } catch (error: Error | any) {
            console.error('Error updating order status:', error);
            res.status(500).json({ error: error.message });
        }
    }
);
```

---

## FIX 4: Add GeoPoint to Order Payload

**File:** `frontend/src/component/UserAccount/PaymentPortal/Payment.tsx`
**Location:** Lines 115-130 (in the callback)

### Current Code (INCOMPLETE):
```typescript
callback={async (
    payment_id: string,
    razorpay_signature: string,
    razorpay_order_id: string,
) => {
    try {
        const token = await getToken()
        if (singleProductDetail) {
            const response = await fetch(`http://localhost:5000/user-order`, {
                method: 'PUT',
                headers: {
                    'Content-Type': `application/json`,
                    Authorization: `Bearer ${token}`,
                    'x-user-id': userData?._id ?? ''
                },
                body: JSON.stringify({
                    customer: userData?._id,
                    customerEmail: userData?.email,
                    product: singleProductDetail?._id,
                    transactionId: payment_id,
                    orderId: razorpay_order_id,
                    pincode: userData?.address.pincode,
                    paymentSignature: razorpay_signature,
                    amount: singleProductDetail?.price?.pdtPrice * singleProductDetail?.quantity,
                    quantity: singleProductDetail?.quantity
                    // ❌ MISSING: geoPoint
                })
            });
```

### Fixed Code:
```typescript
callback={async (
    payment_id: string,
    razorpay_signature: string,
    razorpay_order_id: string,
) => {
    try {
        const token = await getToken()
        if (singleProductDetail) {
            const response = await fetch(`http://localhost:5000/user-order`, {
                method: 'PUT',
                headers: {
                    'Content-Type': `application/json`,
                    Authorization: `Bearer ${token}`,
                    'x-user-id': userData?._id ?? ''
                },
                body: JSON.stringify({
                    customer: userData?._id,
                    customerEmail: userData?.email,
                    product: singleProductDetail?._id,
                    transactionId: payment_id,
                    orderId: razorpay_order_id,
                    pincode: userData?.address.pincode,
                    paymentSignature: razorpay_signature,
                    amount: singleProductDetail?.price?.pdtPrice * singleProductDetail?.quantity,
                    quantity: singleProductDetail?.quantity,
                    // ✅ ADD: geoPoint from user data
                    geoPoint: userData?.geoPoint || {
                        _type: 'geopoint',
                        lat: 0,
                        lng: 0
                    }
                })
            });
```

---

## FIX 5: Add Missing Import

**File:** `kafka-consumers/src/AfterOrderPlaceConsumer.ts`
**Location:** Top of file

### Current Imports:
```typescript
import { EachMessagePayload, Kafka, logLevel } from "kafkajs";
import { createClient, SanityClient } from "@sanity/client";
import { createClient as RedisClient } from "redis";
import type { ProductType } from "../declaration/productType.d.ts";
import { sanityConfig } from "@utils";
import { uuidv7 as uuid } from 'uuidv7'
```

### Already Has UUID Import ✅
The `uuid()` function is already imported, so the order creation code will work.

---

## DEPLOYMENT CHECKLIST

- [ ] Update `kafka-consumers/src/AfterOrderPlaceConsumer.ts`
  - [ ] Add order creation code after seller inventory update
  - [ ] Add error logging in catch block

- [ ] Update `server/payment_service/src/index.ts`
  - [ ] Add order retrieval endpoints (GET /user-orders/:userId, GET /order/:orderId)
  - [ ] Add order status update endpoint (PUT /order/:orderId/status)

- [ ] Update `frontend/src/component/UserAccount/PaymentPortal/Payment.tsx`
  - [ ] Add geoPoint to order payload

- [ ] Test the flow end-to-end
- [ ] Verify orders appear in Sanity after payment
- [ ] Verify users can retrieve their orders
- [ ] Check error logs have proper messages

---

## QUICK VERIFICATION

After deploying fixes, run these commands:

### 1. Check for existing orders in Sanity:
```
Query in Sanity Studio:
*[_type == 'order']
```

### 2. Test order creation with curl:
```bash
# Get orders for a user
curl -X GET http://localhost:5000/user-orders/{userId} \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json"
```

### 3. Check consumer logs:
```bash
docker exec kafka-consumers tail -f logs/after-order-place-consumer-out.log
```

### 4. Monitor Kafka topic:
```bash
docker exec kafka1 kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic update-product-quantity-topic \
  --from-beginning \
  --max-messages 1
```
