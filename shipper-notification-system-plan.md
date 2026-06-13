# Shipper Notification & Delivery Claim System — Architecture Plan

## Overview

When a seller accepts an order (identified by pincode), nearby shippers at that pincode receive real-time notifications via SSE. The first shipper to claim the delivery gets assigned via a Redis-backed distributed lock. A bell icon in the top-right navbar displays unread notifications.

---

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     SELLER ACCEPTS ORDER (pincode: 700135)              │
└──────────────────┬──────────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    seller_service (port 5003)                            │
│  After seller accepts order → publish to Kafka: "shipper-event-topic"   │
│  Payload: { sellerOrderId, pincode, orderId, sellerId, products }      │
└──────────────────┬──────────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              kafka-consumer: ShipperNotificationConsumer                  │
│  - Consumes "shipper-event-topic"                                       │
│  - Looks up all shippers with address_pincode == event.pincode          │
│  - Creates a notification record in Redis (hash per shipper)            │
│  - Publishes to "shipper-notification-topic" with shipper IDs           │
│  - Also stores notification in MySQL for persistence                    │
└──────────────────┬──────────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    SSE Service (port 4000)                                │
│  - Consumes "shipper-notification-topic"                                │
│  - New SSE endpoint: /shipper-notifications?shipperId=shipper-xxx       │
│  - Bridges Kafka messages → SSE events to connected shipper clients     │
│  - Filters by shipperId query param                                     │
└──────────────────┬──────────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              FRONTEND — Shipper Portal (React)                           │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Navbar (transparent)                                           │   │
│  │  ┌──────┐  ┌─────────┐  ┌──────────────────┐  ┌──────────┐    │   │
│  │  │  XV  │  │ Shipper │  │ 🔔 Bell Icon (3) │  │ UserBtn  │    │   │
│  │  │      │  │ Portal  │  │  ┌──────────┐    │  │ ┌────┐   │    │   │
│  │  └──────┘  └─────────┘  │  │Dropdown  │    │  │ │Name│   │    │   │
│  │                          │  │List      │    │  │ │User│   │    │   │
│  │                          │  └──────────┘    │  │ └────┘   │    │   │
│  │                          └──────────────────┘  └──────────┘    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  - Connects to SSE: /shipper-notifications?shipperId=...                │
│  - Each SSE event: { type: "new_delivery", orderId, pincode, amount }   │
│  - Bell icon shows unread count badge                                   │
│  - Dropdown lists notifications with "Accept" button                    │
│  - Accept → POST /shipper/accept-delivery → Redis lock → assign         │
└──────────────────────────────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                LOCKING MECHANISM (Redis + shipper_service)               │
│                                                                          │
│  POST /shipper/accept-delivery                                           │
│  {                                                                       │
│    shipperId: "shipper-xxx",                                             │
│    sellerOrderId: "uuid",                                                │
│    sellerId: "seller-yyy",                                               │
│    orderId: "order-zzz",                                                 │
│    pincode: "700135",                                                    │
│    products: [...]                                                       │
│  }                                                                       │
│                                                                          │
│  1. Redis SETNX delivery:claim:{sellerOrderId} {shipperId} NX EX 3600   │
│     → Returns 0 if key exists (already claimed)                         │
│     → Returns 1 if lock acquired (first claimant)                       │
│  2. If lock acquired → call seller_service /assign-shipper              │
│  3. If lock not acquired → return 409 Conflict "Already assigned"      │
│  4. Notify SSE that this shipper's claim was accepted/rejected          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Redis — Real-time Notifications

```
Key: "shipper:notifications:{shipperId}"
Type: LIST (LPUSH new notifications)

Notification Object:
{
  "id": "uuid",
  "type": "new_delivery",
  "sellerOrderId": "uuid",
  "orderId": "order-xxx",
  "sellerId": "seller-yyy",
  "pincode": "700135",
  "amount": 1500.00,
  "customerAddress": "...",
  "products": [{ "productId": "p1", "quantity": 2, "productName": "..." }],
  "claimed": false,
  "claimedBy": null,
  "createdAt": "ISO timestamp",
  "expiresAt": "ISO timestamp"
}
```

### Redis — Distributed Lock (claim gating)

```
Key: "delivery:claim:{sellerOrderId}"
Value: { shipperId: "shipper-xxx", claimedAt: "ISO timestamp" }
TTL: 3600 seconds (1 hour) — enough for the assignment flow
```

### MySQL — Persistent Notification History

Run on **global_sql_data** (new table):

```sql
CREATE TABLE IF NOT EXISTS shipper_notifications (
    id VARCHAR(255) PRIMARY KEY,
    shipper_id VARCHAR(255) NOT NULL,
    type ENUM('new_delivery') NOT NULL DEFAULT 'new_delivery',
    seller_order_id VARCHAR(255) NOT NULL,
    order_id VARCHAR(255) NOT NULL,
    seller_id VARCHAR(255) NOT NULL,
    pincode CHAR(6) NOT NULL,
    amount DECIMAL(10,2),
    payload JSON COMMENT 'Full notification payload including products',
    read_status ENUM('unread', 'read', 'claimed', 'expired') DEFAULT 'unread',
    claim_status ENUM('pending', 'accepted', 'rejected_by_other', 'expired') DEFAULT 'pending',
    claimed_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_shipper_status (shipper_id, read_status),
    INDEX idx_seller_order (seller_order_id),
    INDEX idx_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## Implementation Steps

### Step 1: Database Migration
- Create `shipper_notifications` table on global_sql_data
- Add `address_pincode` index on `shippers` table (if not present) for fast pincode lookup

### Step 2: Redis Utility — Lock Service
- Add a `claimLock` function using `SETNX` in the shipper_service
- Add a `releaseLock` for cleanup
- Add `getUnclaimedDeliveries` to list available deliveries by pincode

### Step 3: Kafka Topics
- Create topic `shipper-notification-topic` in KafkaAdmin.ts
- Create topic `shipper-claim-response-topic` (optional, for real-time claim status)

### Step 4: New Kafka Consumer — `ShipperNotificationConsumer`
- Consumes from a new topic (e.g., `shipper-delivery-event-topic`)
- On message:
  1. Parse event payload (sellerOrderId, pincode, orderId, sellerId, amount, products)
  2. Query global DB: `SELECT id FROM shippers WHERE address_pincode = ?`
  3. For each shipper in that pincode:
     - Insert into `shipper_notifications` table (persistent)
     - LPUSH to Redis `shipper:notifications:{shipperId}`
     - Set TTL on Redis list (e.g., 24 hours)
  4. Publish to `shipper-notification-topic` with the batch of shipper IDs

### Step 5: SSE Service Update
- Add new SSE endpoint: `GET /shipper-notifications?shipperId=shipper-xxx`
- Subscribe to `shipper-notification-topic` in Kafka consumer
- Emit events filtered by `shipperId` from query param
- Event format: `{ type: "new_notification", data: { ...notification } }`

### Step 6: Shipper Service — New Endpoints

#### `GET /shipper/notifications/:shipperId`
- Returns list of notifications from Redis (if available) or MySQL fallback
- Supports `?status=unread` filter
- Returns notifications sorted by createdAt DESC

#### `POST /shipper/notifications/:notificationId/read`
- Mark a single notification as read
- Update both Redis and MySQL

#### `POST /shipper/accept-delivery`
- Input: `{ shipperId, sellerOrderId, sellerId, orderId, pincode, products }`
- Flow:
  1. Validate input
  2. **Redis SETNX** `delivery:claim:{sellerOrderId}` → `{ shipperId, claimedAt }` with TTL 1h
  3. If lock acquired → call `seller_service/assign-shipper` (via internal HTTP or Kafka)
  4. Update notification status to `claimed` / `accepted`
  5. If lock NOT acquired → return `409 Conflict` + `{ message: "Already assigned", claimedBy: "shipper-xxx" }`
  6. Publish claim result to SSE topic so UI can update

#### `GET /shipper/unread-count/:shipperId`
- Returns `{ count: N }` — unread notification count for badge

### Step 7: Frontend — Notification Bell Component
- New component: `ShipperNotificationBell.tsx`
- Location: `frontend/src/component/ShipperAccount/Navbar/`
- Features:
  - SSE connection to `/shipper-notifications?shipperId=...` on component mount
  - Bell icon with unread count badge
  - Dropdown panel listing notifications (latest first)
  - Each notification shows: order ID, pincode, amount, time ago
  - "Accept Delivery" button on each unclaimed notification
  - Clicking "Accept" → calls `POST /shipper/accept-delivery`
  - On success → notification moves to "claimed" state with green check
  - On 409 → notification shows "Already assigned" in red
  - Sound/visual ping on new notification (optional)

### Step 8: Navbar Integration
- Insert `ShipperNotificationBell` between the right section and user button
- Update `ShipperNavbar.tsx`:

```tsx
<div className={styles.rightSection}>
  <SignedOut>
    <SignInButton mode="modal">
      <button className={styles.signInBtn}>Sign In</button>
    </SignInButton>
  </SignedOut>
  <SignedIn>
    <ShipperNotificationBell />
    <div className={styles.userBtn}>
      <span>{user?.firstName || "Shipper"}</span>
      <UserButton />
    </div>
  </SignedIn>
  {onToggleSidebar && (
    <button className={styles.hamburger} onClick={onToggleSidebar} aria-label="Toggle sidebar">
      <GiHamburgerMenu size={22} />
    </button>
  )}
</div>
```

---

## Kafka Topics Summary

| Topic | Producer | Consumer | Purpose |
|-------|----------|----------|---------|
| `shipper-delivery-event-topic` | seller_service | ShipperNotificationConsumer | Seller accepted order → notify shippers |
| `shipper-notification-topic` | ShipperNotificationConsumer | SSE Service | Push notification to connected shippers |
| `shipper-claim-response-topic` | shipper_service | SSE Service (optional) | Real-time claim result |

---

## Locking Strategy Details

**Problem**: Two shippers (A and B) both see the same notification and click "Accept" simultaneously.

**Solution**: Redis `SETNX` with atomic lock:

```
SETNX delivery:claim:{sellerOrderId} {shipperId}
EX 3600
NX
```

- Redis guarantees atomicity — only one `SETNX` succeeds
- First success → shipper gets assigned
- Second fails → shipper gets 409 error
- TTL of 1 hour prevents deadlocks if the assignment flow fails midway

**Fallback**: If Redis is down, fall back to MySQL with `INSERT ... ON DUPLICATE KEY` or a `GET_LOCK()` advisory lock.

---

## Claim Race Condition — Timeline

```
Time  │  Seller accepts order (pincode 700135)
      │    ↓
t+0s  │  Kafka event published
      │    ↓
t+1s  │  Consumer looks up shippers at pincode 700135 → 10 shippers found
      │    ↓
t+2s  │  Notifications created in Redis + MySQL for all 10 shippers
      │    ↓
t+3s  │  SSE pushes notification to all 10 connected shippers
      │    ↓
t+4s  │  Shipper A clicks "Accept" → POST /shipper/accept-delivery
      │  Shipper B clicks "Accept" → POST /shipper/accept-delivery
      │    ↓
t+5s  │  Redis SETNX delivery:claim:{sellerOrderId}
      │    → Shipper A: SETNX returns 1 (LOCK ACQUIRED ✅)
      │    → Shipper B: SETNX returns 0 (LOCK FAILED ❌)
      │    ↓
t+6s  │  Shipper A assigned via seller_service /assign-shipper
      │  Shipper B receives 409 "Already assigned by another shipper"
      │    ↓
t+7s  │  SSE updates:
      │    → Shipper A: "Delivery claimed — navigating to order details"
      │    → Shipper B: "Delivery already assigned — notification marked expired"
```

---

## Notification Retention & Cleanup

- **Redis**: TTL of 24 hours on `shipper:notifications:{shipperId}` lists
- **MySQL**: Notifications kept indefinitely for audit/history
- **Cron job** (optional): Cleanup Redis keys for shippers inactive > 7 days
