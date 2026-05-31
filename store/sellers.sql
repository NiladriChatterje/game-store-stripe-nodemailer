USE xvstore;
CREATE TABLE IF NOT EXISTS sellers (
    id VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    gstin VARCHAR(15),
    phone BIGINT,
    email VARCHAR(255) NOT NULL,
    status ENUM('active','suspended','closed') DEFAULT 'active',
    UNIQUE KEY uq_seller_email (email),
    geo_lat DOUBLE,
    geo_lng DOUBLE,
    address_pincode CHAR(6),
    address_county VARCHAR(255),
    address_country VARCHAR(255),
    address_state VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    status ENUM('active','suspended','closed') DEFAULT 'active',
    UNIQUE KEY uq_seller_email (email)
);

CREATE TABLE IF NOT EXISTS store(
    id INT PRIMARY KEY,
    seller_id VARCHAR(60) NOT NULL,
    pincode CHAR(6),
    county VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS seller_subscriptions (
    id VARCHAR(255) PRIMARY KEY,
    seller_id VARCHAR(255) NOT NULL,
    transaction_id VARCHAR(255) NOT NULL,
    order_id VARCHAR(255) NOT NULL,
    payment_signature VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    store_allotment INT NOT NULL DEFAULT 1,
    plan_active_date DATETIME NOT NULL,
    plan_expire_date DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE
);
