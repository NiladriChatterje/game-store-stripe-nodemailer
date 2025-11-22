# Order Placement Flow Analysis

## Overview
This document traces the complete flow of user order placement from the frontend through payment processing to Kafka and database storage.

---

## 1️⃣ FRONTEND - Payment Initiation

### File: `frontend/src/utils/Checkout.tsx`

**Step 1.1: User clicks "Pay Now" button**
- Component: `<Checkout />` 
- Calls `handlePayment()` function

**Step 1.2: Create Razorpay Order**
```
POST http://localhost:5000/razorpay
Headers:
  - Authorization: Bearer {token}
  - x-user-id: {userData._id}
Body:
  - price: {total_amount * 100} (in paise)
```

**Step 1.3: Razorpay Payment Modal Opens**
- User completes payment in Razorpay UI
- On successful payment, Razorpay handler callback triggers with:
  - `razorpay_payment_id` (payment_id)
  - `razorpay_order_id` (order_id)
  - `razorpay_signature` (payment signature)

**Step 1.4: Callback Function Executes**
- If payment successful → calls `_callback()` with payment details
- Navigates to `/user/completion/` page

---

## 2️⃣ FRONTEND - Order Submission After Payment

### File: `frontend/src/component/UserAccount/PaymentPortal/Payment.tsx`

**Step 2.1: Callback Handler Triggered**
```typescript
callback = async (
  payment_id: string,
  razorpay_signature: string,
  razorpay_order_id: string
) => {
  // Prepare order data
  const orderData = {
    customer: userData._id,
    customerEmail: userData.email,
    product: productId,
    transactionId: payment_id,
    orderId: razorpay_order_id,
    pincode: userData.address.pincode,
    paymentSignature: razorpay_signature,
    amount: productPrice * quantity,
    quantity: quantity
  }
  
  // Send to backend
  PUT http://localhost:5000/user-order
}
```

**Step 2.2: Order Data Sent to Payment Service**
```
PUT http://localhost:5000/user-order
Headers:
  - Authorization: Bearer {token}
  - x-user-id: {userData._id}
  - Content-Type: application/json
Body:
  {
    customer: userId,
    customerEmail: email,
    product: productId,
    transactionId: payment_id,
    orderId: razorpayOrderId,
    paymentSignature: signature,
    amount: totalAmount,
    pincode: userPincode,
    quantity: quantity
  }
```

---

## 3️⃣ BACKEND - Payment Service Processing

### File: `server/payment_service/src/index.ts`

**Step 3.1: Endpoint Handler**
```typescript
app.put('/user-order',
  verifyClerkToken,  // Verify user token
  async (req, res) => {
    const producer = kafka.producer();
    await producer.connect();
    
    // Push order to Kafka
    producer.send({
      topic: 'update-product-quantity-topic',
      messages: [{ value: JSON.stringify(req.body) }]
    });
    
    // Send confirmation email
    sendMail({
      to: req.body.customerEmail
    });
  }
)
```

**Step 3.2: Order Pushed to Kafka Topic**
- Topic: `update-product-quantity-topic`
- Message: Order payload (JSON)
- Contains: customer, product, payment details, quantity, pincode, etc.

---

## 4️⃣ KAFKA - Message Queue

### Topic: `update-product-quantity-topic`

**Message Format:**
```json
{
  "customer": "userId",
  "customerEmail": "user@email.com",
  "product": "productId",
  "transactionId": "payment_id",
  "orderId": "razorpay_order_id",
  "paymentSignature": "signature",
  "amount": 5000,
  "pincode": 110001,
  "quantity": 2
}
```

---

## 5️⃣ KAFKA CONSUMER - Processing

### File: `kafka-consumers/src/AfterOrderPlaceConsumer.ts`

**Step 5.1: Consumer Subscribes to Topic**
```typescript
const consumer = kafka.consumer({
  groupId: "product-quantity-reduction"
});

await consumer.subscribe({
  topic: "update-product-quantity-topic"
});
```

**Step 5.2: Message Processing**
1. **Parse Order Data**
   - Extract product ID, quantity, pincode, geolocation

2. **Fetch Current Product Quantity**
   ```
   Query Sanity:
   *[_type == 'product' && _id match '{productId}'][0]{
     _id,
     "quantityObj": quantity[pincode match "{userPincode}"][0]
   }
   ```

3. **Update Product Quantity in Sanity**
   ```
   PATCH product document:
   - Reduce quantity for the pincode
   - Insert new quantity record with uuid key
   ```

4. **Find Nearby Seller**
   ```
   Query Sanity for seller_product_details:
   - Match product ID
   - Quantity >= order quantity
   - Calculate distance from user location
   - Order by distance (ascending)
   - Select closest seller [0]
   ```

5. **Update Seller Product Details**
   ```
   createOrReplace in Sanity:
   {
     _id: seller_id,
     _type: 'seller_product_details',
     seller_id: sellerId,
     product_id: productId,
     pincode: userPincode,
     quantity: (seller_qty - order_qty),
     geoPoint: userLocation
   }
   ```

6. **Update Redis Cache**
   ```
   redisClient.hset(
     "products:details",
     productId,
     JSON.stringify(updatedProduct)
   )
   ```

7. **Commit Offset**
   ```
   consumer.commitOffsets([
     { topic, partition, offset }
   ]);
   ```

---

## 🎯 FLOW SUMMARY

```
Frontend (Payment Page)
    ↓
1. User clicks "Pay Now"
    ↓
2. Request Order from Razorpay (GET ORDER_ID)
    ↓
3. Open Razorpay Modal → User Completes Payment
    ↓
4. Razorpay Returns: payment_id, order_id, signature
    ↓
5. Callback Handler Triggered
    ↓
Backend (Payment Service at :5000)
    ↓
6. PUT /user-order endpoint receives order data
    ↓
7. Verify Clerk Token
    ↓
8. Push message to Kafka topic: "update-product-quantity-topic"
    ↓
9. Send confirmation email to customer
    ↓
10. Response: 201 "new order added"
    ↓
Kafka Message Queue
    ↓
11. Message sits in topic waiting for consumer
    ↓
Kafka Consumer (AfterOrderPlaceConsumer)
    ↓
12. Consumer receives message from topic
    ↓
13. Parse order payload
    ↓
14. Query Sanity: Fetch current product quantity
    ↓
15. Update Sanity: Reduce product quantity for pincode
    ↓
16. Query Sanity: Find nearest seller with available qty
    ↓
17. Update Sanity: Update seller's product details
    ↓
18. Update Redis: Cache updated product info
    ↓
19. Commit Kafka offset
    ↓
Database (Sanity CMS)
    ↓
20. Product quantity reduced
21. Seller inventory updated
22. Order recorded
    ↓
Cache (Redis)
    ↓
23. Product details cached for fast retrieval
    ↓
✅ Order Complete
```

---

## ⚠️ POTENTIAL ISSUES IN CURRENT FLOW

### 1. **Missing Order Document Creation**
**Issue:** The Kafka consumer processes product quantity reduction but **DOES NOT** create an `Order` document in Sanity.

**Current behavior:**
- ✅ Updates product quantity
- ✅ Updates seller inventory
- ✅ Updates Redis cache
- ❌ **Does NOT create Order document**

**What should happen:**
```typescript
// In AfterOrderPlaceConsumer, after quantity updates:
await sanityClient.createOrReplace({
  _id: uuid(), // Generate unique order ID
  _type: 'order',
  customer: {_ref: productPayload.customer},
  product: [{_ref: productPayload.product}],
  quantity: productPayload.quantity,
  transactionId: productPayload.transactionId,
  orderId: productPayload.orderId,
  paymentSignature: productPayload.paymentSignature,
  amount: productPayload.amount,
  status: 'orderPlaced',
  _createdAt: new Date().toISOString()
})
```

### 2. **No Order Retrieval Endpoint**
**Issue:** Users cannot fetch their orders from the system.

**Current:**
- Payment service has no `/get-user-orders` endpoint
- userData service has `/delivery-orders/:userId` but requires status to be already set

**What's needed:**
```typescript
app.get('/orders/:userId',
  verifyUserToken,
  async (req, res) => {
    const orders = await sanityClient.fetch(`
      *[_type=="order" && customer._ref == $userId] {
        _id,
        customer->{_id, username, email},
        product[]->{_id, productName, price},
        quantity,
        amount,
        status,
        _createdAt
      }
    `, { userId: req.params.userId });
    res.json(orders);
  }
)
```

### 3. **Missing GeoPoint in Order Payload**
**Issue:** AfterOrderPlaceConsumer tries to use `productPayload.geoPoint` but it's not sent from frontend.

**Error Location:** Line 93 in AfterOrderPlaceConsumer.ts
```typescript
distance: geo::distance(
  geoPoint, 
  geo::latLng(${productPayload.geoPoint.lat}, ...) // ❌ May be undefined
)
```

**Fix:** Send user's location from frontend:
```typescript
// In Payment.tsx callback
body: JSON.stringify({
  ...orderData,
  geoPoint: userData?.geoPoint || {lat: 0, lng: 0}
})
```

### 4. **No Error Handling for Failed Messages**
**Issue:** The Kafka consumer silently catches errors with empty catch block.

```typescript
catch (error: Error | any) {
  // ❌ Empty - errors are swallowed
}
```

**Should log and track failures:**
```typescript
catch (error: Error | any) {
  console.error('Failed to process order:', error);
  // Could push to dead-letter topic for replay
}
```

---

## ✅ CURRENT WORKING PARTS

1. **Frontend Payment Flow** ✓
   - Razorpay integration working
   - Payment successful callback triggers

2. **Kafka Connection** ✓
   - Messages successfully pushed to Kafka topic
   - Consumer subscribes and receives messages

3. **Inventory Updates** ✓
   - Product quantity correctly reduced
   - Seller inventory updated
   - Redis cache updated

4. **Email Notifications** ✓
   - Confirmation email sent to customer

---

## ❌ MISSING/BROKEN PARTS

1. **Order Document Storage** ❌
   - No order created in Sanity database
   - Users cannot retrieve their orders

2. **Order Status Tracking** ❌
   - No way to track order progression (orderPlaced → dispatched → shipped)
   - Shipper cannot find orders to update status

3. **Error Recovery** ❌
   - Failed messages not tracked or retried
   - No dead-letter topic for failed orders

4. **User Order History** ❌
   - No endpoint to fetch user's order history
   - Frontend Orders page has no data source

---

## 📋 RECOMMENDED FIXES

### Priority 1 (Critical)
1. **Create Order Document in Kafka Consumer**
   - Add order creation to Sanity in AfterOrderPlaceConsumer.ts

2. **Add Error Logging**
   - Log all errors in consumer with message details for debugging

### Priority 2 (High)
1. **Add GeoPoint to Order Payload**
   - Send user's location from frontend to backend

2. **Create Order Retrieval Endpoints**
   - Add GET endpoint in payment service for user orders
   - Add GET endpoint in userData service for order history

### Priority 3 (Medium)
1. **Implement Dead-Letter Topic**
   - Create separate topic for failed messages
   - Add retry mechanism

2. **Add Order Status Updates**
   - Allow shipper to update order status
   - Push updates through Kafka to update database

---

## 🔍 TO VERIFY

1. **Check Kafka Topics:**
   ```bash
   docker exec kafka1 kafka-topics --bootstrap-server localhost:9092 --list
   ```

2. **Check Consumer Lag:**
   ```bash
   docker exec kafka1 kafka-consumer-groups --bootstrap-server localhost:9092 --group product-quantity-reduction --describe
   ```

3. **Check Sanity Orders:**
   ```
   *[_type == 'order']
   ```

4. **Monitor Consumer Logs:**
   ```bash
   tail -f logs/after-order-place-consumer-out.log
   tail -f logs/after-order-place-consumer-error.log
   ```

---

## TESTING CHECKLIST

- [ ] User completes payment successfully
- [ ] Razorpay callback triggers
- [ ] Message appears in Kafka topic
- [ ] Consumer processes message
- [ ] Product quantity reduced in Sanity
- [ ] Seller inventory updated in Sanity
- [ ] **Order document created in Sanity** ← MISSING
- [ ] User can retrieve orders from backend
- [ ] Order status shows as 'orderPlaced'
- [ ] Email sent to user
- [ ] Redis cache updated
