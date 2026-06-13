USE xvstore;

-- Add pincode column to seller_orders for multi-store grouping
-- This allows grouping/filtering orders by the store (pincode) they belong to
ALTER TABLE seller_orders
ADD COLUMN IF NOT EXISTS pincode CHAR(6) DEFAULT NULL AFTER seller_id,
ADD INDEX idx_pincode (pincode);
