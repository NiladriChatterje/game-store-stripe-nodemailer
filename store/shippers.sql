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
