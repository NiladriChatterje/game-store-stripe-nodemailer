USE xvstore;

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

CREATE TABLE IF NOT EXISTS product_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    size INT,
    base64 LONGTEXT,
    extension VARCHAR(10),
    CONSTRAINT fk_product_images_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_keywords (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    keyword VARCHAR(255) NOT NULL,
    CONSTRAINT fk_product_keywords_product_id FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);



CREATE TABLE IF NOT EXISTS product_quantities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id VARCHAR(255) NOT NULL,
    seller_id VARCHAR(255) NOT NULL,
    pincode CHAR(6) NOT NULL,
    quantity INT NOT NULL,
    UNIQUE KEY uq_product_seller_pincode (product_id, seller_id, pincode),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_embeddings (
    id VARCHAR(255) PRIMARY KEY,
    product_id VARCHAR(255),
    embeddings JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS potential_duplicates (
    id VARCHAR(255) PRIMARY KEY,
    existing_product_id VARCHAR(255) NOT NULL,
    potential_duplicate_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
