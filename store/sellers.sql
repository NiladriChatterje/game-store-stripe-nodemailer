CREATE TABLE IF NOT EXISTS sellers (
    id VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    gstin VARCHAR(15),
    phone BIGINT,
    email VARCHAR(255) NOT NULL,
    geo_lat DOUBLE,
    geo_lng DOUBLE,
    address_pincode CHAR(6),
    address_county VARCHAR(255),
    address_country VARCHAR(255),
    address_state VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

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
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE
);
