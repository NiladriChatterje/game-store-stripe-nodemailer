-- MySQL Schema generated from Sanity Studio Definitions

-- Users Table (from documents/UserType.ts)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    phone BIGINT,
    email VARCHAR(255) NOT NULL,
    geo_lat DOUBLE,
    geo_lng DOUBLE,
    address_pincode VARCHAR(20),
    address_county VARCHAR(255),
    address_country VARCHAR(255),
    address_state VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Admins/Sellers Table (from documents/AdminType.ts)
CREATE TABLE IF NOT EXISTS sellers (
    id VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    gstin VARCHAR(15),
    phone BIGINT,
    email VARCHAR(255) NOT NULL,
    geo_lat DOUBLE,
    geo_lng DOUBLE,
    address_pincode VARCHAR(20),
    address_county VARCHAR(255),
    address_country VARCHAR(255),
    address_state VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Admin Subscriptions (from documents/AdminType.ts and Objects/AdminSubsPlan.ts)
CREATE TABLE IF NOT EXISTS seller_subscriptions (
    id VARCHAR(255) PRIMARY KEY,
    seller_id VARCHAR(255) NOT NULL,
    transaction_id VARCHAR(255) NOT NULL,
    order_id VARCHAR(255) NOT NULL,
    payment_signature VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    plan_active_date DATETIME NOT NULL,
    plan_expire_date DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

-- Shippers Table (from documents/ShipperType.ts)
CREATE TABLE IF NOT EXISTS shippers (
    id VARCHAR(255) PRIMARY KEY,
    shippername VARCHAR(255) NOT NULL,
    phone BIGINT NOT NULL,
    email VARCHAR(255) NOT NULL,
    geo_lat DOUBLE,
    geo_lng DOUBLE,
    address_pincode VARCHAR(20),
    address_county VARCHAR(255),
    address_country VARCHAR(255),
    address_state VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products Table (from documents/ProductType.ts)
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Product Images (from documents/ProductType.ts)
CREATE TABLE IF NOT EXISTS product_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    size INT,
    base64 LONGTEXT,
    extension VARCHAR(10),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Product Keywords (from documents/ProductType.ts)
CREATE TABLE IF NOT EXISTS product_keywords (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    keyword VARCHAR(255) NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Product Quantities by Pincode (from documents/ProductType.ts "quantity" pair array)
CREATE TABLE IF NOT EXISTS product_quantities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    pincode VARCHAR(20) NOT NULL,
    quantity INT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Product Sellers (Many-to-Many products <-> admins) (from documents/ProductType.ts)
CREATE TABLE IF NOT EXISTS product_sellers (
    product_id VARCHAR(255) NOT NULL,
    admin_id VARCHAR(255) NOT NULL,
    PRIMARY KEY (product_id, admin_id),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

-- Product Embeddings (from documents/ProductEmbeddingsType.ts)
CREATE TABLE IF NOT EXISTS product_embeddings (
    id VARCHAR(255) PRIMARY KEY, -- Assuming 1:1 with product? Or own ID. 
    product_id VARCHAR(255), -- Optional link if needed, though schema just says 'embeddings'
    embeddings JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Potential Duplicates (from documents/PotentialDuplicatesType.ts)
CREATE TABLE IF NOT EXISTS potential_duplicates (
    id VARCHAR(255) PRIMARY KEY,
    existing_product_id VARCHAR(255) NOT NULL,
    potential_duplicate_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    -- FOREIGN KEY (existing_product_id) REFERENCES products(id), -- Optional constraint
    -- FOREIGN KEY (potential_duplicate_id) REFERENCES products(id) -- Optional constraint
);

-- Orders Table (from documents/OrderType.ts)
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(255) PRIMARY KEY, -- Sanity Document ID
    order_id_display VARCHAR(255) NOT NULL, -- "orderId" field
    customer_id VARCHAR(255),
    shipper_id VARCHAR(255),
    quantity INT,
    transaction_id VARCHAR(255) NOT NULL,
    payment_signature VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status ENUM('orderPlaced', 'dispatched', 'shipping', 'shipped') DEFAULT 'orderPlaced',
    fulfilled_quantity INT,
    refund_amount DECIMAL(10, 2),
    refund_status ENUM('pending', 'processing', 'completed', 'failed'),
    partial_fulfillment_reason TEXT,
    razorpay_refund_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (shipper_id) REFERENCES shippers(id) ON DELETE SET NULL
);

-- Order Products (Many-to-Many orders <-> products) (from documents/OrderType.ts)
CREATE TABLE IF NOT EXISTS order_products (
    order_id VARCHAR(255) NOT NULL,
    product_id VARCHAR(255) NOT NULL,
    PRIMARY KEY (order_id, product_id),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Orders Accepted By Seller (from documents/OrderAcceptedBySellerType.ts)
CREATE TABLE IF NOT EXISTS seller_orders (
    id VARCHAR(255) PRIMARY KEY,
    order_id VARCHAR(255) NOT NULL,
    seller_id VARCHAR(255) NOT NULL,
    status ENUM('pending', 'accepted', 'rejected', 'processing', 'ready_to_ship') DEFAULT 'pending',
    total_amount DECIMAL(10, 2) NOT NULL,
    accepted_at DATETIME,
    rejection_reason VARCHAR(255),
    notes TEXT,
    is_partial_fulfillment BOOLEAN DEFAULT FALSE,
    fulfilled_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (seller_id) REFERENCES admins(id) ON DELETE CASCADE
);

-- Seller Order Items (Products assigned to seller in an order) (from documents/OrderAcceptedBySellerType.ts)
CREATE TABLE IF NOT EXISTS seller_order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    seller_order_id VARCHAR(255) NOT NULL,
    product_id VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (seller_order_id) REFERENCES seller_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Refund Audit Trail (from documents/RefundAuditType.ts)
CREATE TABLE IF NOT EXISTS refund_audits (
    id VARCHAR(255) PRIMARY KEY,
    order_id VARCHAR(255) NOT NULL,
    customer_id VARCHAR(255) NOT NULL,
    original_amount DECIMAL(10, 2) NOT NULL,
    fulfilled_amount DECIMAL(10, 2),
    refund_amount DECIMAL(10, 2) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    razorpay_refund_id VARCHAR(255),
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    error_message TEXT,
    processed_at DATETIME NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User Cart (from documents/UserCartType.ts)
CREATE TABLE IF NOT EXISTS user_carts (
    id VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User Cart Items (from documents/UserCartType.ts)
CREATE TABLE IF NOT EXISTS user_cart_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cart_id VARCHAR(255) NOT NULL,
    product_id VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    FOREIGN KEY (cart_id) REFERENCES user_carts(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Seller Product Details / Region Availability (from documents/seller_product_details.ts)
CREATE TABLE IF NOT EXISTS seller_product_details (
    id VARCHAR(255) PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    seller_id VARCHAR(255) NOT NULL,
    pincode VARCHAR(6) NOT NULL,
    quantity INT DEFAULT 0,
    geo_lat DOUBLE,
    geo_lng DOUBLE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (seller_id) REFERENCES admins(id) ON DELETE CASCADE
);
