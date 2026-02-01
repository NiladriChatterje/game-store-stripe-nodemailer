USE xvstore;
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

CREATE TABLE IF NOT EXISTS order_products (
    order_id VARCHAR(255) NOT NULL,
    product_id VARCHAR(255) NOT NULL,
    PRIMARY KEY (order_id, product_id),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

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
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS seller_order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    seller_order_id VARCHAR(255) NOT NULL,
    product_id VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (seller_order_id) REFERENCES seller_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

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
