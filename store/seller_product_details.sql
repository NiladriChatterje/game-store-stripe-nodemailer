USE xvstore;
CREATE TABLE IF NOT EXISTS seller_product_details (
    id VARCHAR(255) PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    seller_id VARCHAR(255) NOT NULL,
    pincode CHAR(6) NOT NULL,
    quantity INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    -- FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    -- FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE
);
