USE xvstore;
CREATE TABLE IF NOT EXISTS seller_product_details (
    id VARCHAR(255) PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    seller_id VARCHAR(255) NOT NULL,
    pincode CHAR(6) NOT NULL,
    quantity INT DEFAULT 0,
    geo_lat DOUBLE,
    geo_lng DOUBLE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_seller_product_details_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
