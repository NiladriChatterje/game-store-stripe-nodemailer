USE xvstore;

-- store_inventory: tracks which products are stocked in a store, under which seller
CREATE TABLE IF NOT EXISTS store_inventory (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    store_id      INT          NOT NULL,              -- references store(id) in sellers.sql
    product_id    VARCHAR(255) NOT NULL,              -- references products(id) in the shard
    seller_id     VARCHAR(255) NOT NULL,              -- which seller owns this stock entry
    quantity      INT          NOT NULL DEFAULT 0,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_store_product_seller (store_id, product_id, seller_id)
);
