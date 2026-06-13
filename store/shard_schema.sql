-- ============================================================================
-- SHARD SCHEMA — Run on each shard (mysql1 through mysql5)
-- All tables in correct creation order so FK constraints resolve properly.
-- Cross-database foreign keys (referencing global_sql_data tables) have been
-- removed — those are enforced at the application level instead.
-- ============================================================================
-- Creation order:
--   1. products (base, no shard FKs)
--   2. product_images → products
--   3. product_keywords → products
--   4. product_quantities → products
--   5. product_embeddings (no shard FKs)
--   6. potential_duplicates (no shard FKs)
--   7. seller_orders (no cross-DB FKs — order_id/seller_id are app-level refs)
--   8. seller_product_details → products
--   9. seller_order_items → seller_orders, products
--  10. seller_order_shipping → seller_orders (shipper_id is app-level ref to global shippers)
--  11. seller_order_shipping_items → seller_order_shipping
-- ============================================================================

USE xvstore;

-- ===================================================================
-- 1. PRODUCTS (base catalog)
-- ===================================================================
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(255) PRIMARY KEY,
    product_name VARCHAR(255),
    ean_upc_type ENUM('EAN', 'UPC', 'ISBN', 'ASIN', 'GTIN', 'OTHERS'),
    ean_upc_number VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,
    model_number VARCHAR(255),
    product_description TEXT NOT NULL,
    price_currency VARCHAR(3) DEFAULT 'INR',
    price_amount DECIMAL(10, 2),
    price_discount_percentage DECIMAL(5, 2) DEFAULT 0,
    variations JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ===================================================================
-- 2. PRODUCT IMAGES
-- ===================================================================
CREATE TABLE IF NOT EXISTS product_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    size INT,
    base64 LONGTEXT,
    extension VARCHAR(10),
    CONSTRAINT fk_product_images_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- ===================================================================
-- 3. PRODUCT KEYWORDS
-- ===================================================================
CREATE TABLE IF NOT EXISTS product_keywords (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    keyword VARCHAR(255) NOT NULL,
    CONSTRAINT fk_product_keywords_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- ===================================================================
-- 4. PRODUCT QUANTITIES (seller-level inventory by pincode)
-- ===================================================================
CREATE TABLE IF NOT EXISTS product_quantities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    seller_id VARCHAR(255) NOT NULL,
    pincode CHAR(6) NOT NULL,
    quantity INT NOT NULL,
    UNIQUE KEY uq_product_seller_pincode (product_id, seller_id, pincode),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- ===================================================================
-- 5. PRODUCT EMBEDDINGS (vector search)
-- ===================================================================
CREATE TABLE IF NOT EXISTS product_embeddings (
    id VARCHAR(255) PRIMARY KEY,
    product_id VARCHAR(255),
    embeddings JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===================================================================
-- 6. POTENTIAL DUPLICATES
-- ===================================================================
CREATE TABLE IF NOT EXISTS potential_duplicates (
    id VARCHAR(255) PRIMARY KEY,
    existing_product_id VARCHAR(255) NOT NULL,
    potential_duplicate_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===================================================================
-- 7. SELLER ORDERS (per-seller order assignments)
--    NOTE: order_id is a logical reference to global_sql_data.orders(id)
--          seller_id is a logical reference to global_sql_data.sellers(id)
--          No FK constraints — enforced at the application layer.
-- ===================================================================
CREATE TABLE IF NOT EXISTS seller_orders (
    id VARCHAR(255) PRIMARY KEY,
    order_id VARCHAR(255) NOT NULL,
    seller_id VARCHAR(255) NOT NULL,
    pincode CHAR(6) DEFAULT NULL COMMENT 'Store pincode for multi-store grouping',
    status ENUM('pending', 'accepted', 'rejected', 'processing', 'ready_to_ship') DEFAULT 'pending',
    total_amount DECIMAL(10, 2) NOT NULL,
    accepted_at DATETIME,
    rejection_reason VARCHAR(255),
    notes TEXT,
    is_partial_fulfillment BOOLEAN DEFAULT FALSE,
    fulfilled_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order_id (order_id),
    INDEX idx_seller_id (seller_id),
    INDEX idx_pincode (pincode),
    INDEX idx_status (status)
);

-- ===================================================================
-- 8. SELLER PRODUCT DETAILS (inventory per seller per pincode)
--    NOTE: seller_id is a logical reference to global_sql_data.sellers(id)
-- ===================================================================
CREATE TABLE IF NOT EXISTS seller_product_details (
    id VARCHAR(255) PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    seller_id VARCHAR(255) NOT NULL,
    pincode CHAR(6) NOT NULL,
    quantity INT DEFAULT 0,
    geo_lat DOUBLE,
    geo_lng DOUBLE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_spd_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_seller_id (seller_id),
    INDEX idx_pincode (pincode)
);

-- ===================================================================
-- 9. SELLER ORDER ITEMS (products within each seller order)
-- ===================================================================
CREATE TABLE IF NOT EXISTS seller_order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    seller_order_id VARCHAR(255) NOT NULL,
    product_id VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (seller_order_id) REFERENCES seller_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_seller_order_id (seller_order_id)
);

-- ===================================================================
-- 10. SELLER ORDER SHIPPING (shipper assignments for fraud tracing)
--     NOTE: shipper_id is a logical reference to global_sql_data.shippers(id)
-- ===================================================================
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
);

-- ===================================================================
-- 11. SELLER ORDER SHIPPING ITEMS (specific products in each shipment)
-- ===================================================================
CREATE TABLE IF NOT EXISTS seller_order_shipping_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shipping_id VARCHAR(255) NOT NULL,
    product_id VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    FOREIGN KEY (shipping_id) REFERENCES seller_order_shipping(id) ON DELETE CASCADE,
    INDEX idx_shipping_id (shipping_id),
    INDEX idx_product_id (product_id)
);
