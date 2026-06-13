-- ============================================================================
-- SELLER ORDER SHIPPING — Run on EACH SHARD (mysql1-mysql5)
-- ============================================================================
-- Tracks shipper assignments to seller orders for fraud tracing.
-- Each row represents a shipper assigned to fulfill a seller_order.
--
-- FK removed: shipper_id → global_sql_data.shippers(id)   (cross-database)
-- Kept:       seller_order_id → seller_orders(id)          (same shard)
-- Added:      pincode column for shard routing
-- ============================================================================

USE xvstore;

CREATE TABLE IF NOT EXISTS seller_order_shipping (
    id VARCHAR(255) PRIMARY KEY,
    seller_order_id VARCHAR(255) NOT NULL,
    shipper_id VARCHAR(255) NOT NULL,
    order_id VARCHAR(255) NOT NULL,
    seller_id VARCHAR(255) NOT NULL,
    pincode CHAR(6) DEFAULT NULL COMMENT 'Cached pincode for shard routing',
    status ENUM('assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled') DEFAULT 'assigned',
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    picked_up_at DATETIME,
    shipped_at DATETIME COMMENT 'Actual time the shipper dispatched the products',
    delivered_at DATETIME,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (seller_order_id) REFERENCES seller_orders(id) ON DELETE CASCADE,
    INDEX idx_shipper_id (shipper_id),
    INDEX idx_seller_id (seller_id),
    INDEX idx_seller_order_id (seller_order_id),
    INDEX idx_pincode (pincode),
    INDEX idx_status (status),
    INDEX idx_order_id (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS seller_order_shipping_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shipping_id VARCHAR(255) NOT NULL,
    product_id VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    FOREIGN KEY (shipping_id) REFERENCES seller_order_shipping(id) ON DELETE CASCADE,
    INDEX idx_shipping_id (shipping_id),
    INDEX idx_product_id (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
