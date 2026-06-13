-- ============================================================================
-- SHIPPER NOTIFICATIONS — Run on global_sql_data only
-- ============================================================================
-- Stores persistent notification records for shippers.
-- Each notification is created when a seller accepts an order at a pincode
-- that matches the shipper's address_pincode.
-- ============================================================================

USE xvstore;

CREATE TABLE IF NOT EXISTS shipper_notifications (
    id VARCHAR(255) PRIMARY KEY,
    shipper_id VARCHAR(255) NOT NULL,
    type ENUM('new_delivery') NOT NULL DEFAULT 'new_delivery',
    seller_order_id VARCHAR(255) NOT NULL,
    order_id VARCHAR(255) NOT NULL,
    seller_id VARCHAR(255) NOT NULL,
    pincode CHAR(6) NOT NULL,
    amount DECIMAL(10,2),
    payload JSON COMMENT 'Full notification payload including products & customer address',
    read_status ENUM('unread', 'read', 'claimed', 'expired') DEFAULT 'unread',
    claim_status ENUM('pending', 'accepted', 'rejected_by_other', 'expired') DEFAULT 'pending',
    claimed_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_shipper_status (shipper_id, read_status),
    INDEX idx_seller_order (seller_order_id),
    INDEX idx_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add address_pincode index on shippers table for fast pincode lookup (if not already present)
CREATE INDEX IF NOT EXISTS idx_shippers_pincode ON shippers (address_pincode);
