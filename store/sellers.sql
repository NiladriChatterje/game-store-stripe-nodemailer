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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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

-- Tracks which database shards have data for each seller (optimizes multi-shard queries)
CREATE TABLE IF NOT EXISTS seller_to_shards (
    seller_id VARCHAR(255) NOT NULL,
    shard_host VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (seller_id, shard_host)
);

-- Stores belonging to a seller, with pre-computed shard_host for direct lookup.
-- The shard_host is computed via ShardHelper.getShardHost(pincode) at store creation time,
-- which is the same hash algorithm used when storing products in shards.
-- This eliminates the need to hash pincodes at query time or check all shards blindly.
CREATE TABLE IF NOT EXISTS seller_stores (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    seller_id     VARCHAR(255) NOT NULL,
    store_number  INT          NOT NULL COMMENT 'Sequential store number (1, 2, 3...) within this seller',
    pincode       CHAR(6)      NOT NULL,
    shard_host    VARCHAR(50)  NOT NULL COMMENT 'Pre-computed shard host for this pincode',
    county        VARCHAR(100),
    state         VARCHAR(100),
    country       VARCHAR(100),
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
    UNIQUE KEY uq_seller_store_number (seller_id, store_number),
    UNIQUE KEY uq_seller_pincode (seller_id, pincode),
    INDEX idx_shard_host (shard_host)
);
