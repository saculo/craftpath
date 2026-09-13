-- Bulk product import.
--
-- The unique index is not a nicety: it is the backstop that makes "if any row is invalid, nothing
-- is written" true even when application validation cannot see the problem. Between the SKU
-- existence probe and the commit, a concurrent request can create the same SKU; without this
-- constraint that import would succeed and silently duplicate a product. With it, the insert
-- fails, the transaction rolls back, and the caller gets a 409.
--
-- Assumes a `products` table already exists with the columns referenced below. If products are
-- tenant-scoped this must be (tenant_id, sku) instead -- see user_notes.md.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS products_sku_key
    ON products (sku);

-- Supports the `sku = ANY(?)` probe in ProductBulkImportRepository; the unique index above
-- already serves it, so no second index is created.

-- Defensive check constraints. Application validation produces the good error messages; these
-- ensure no other write path can introduce data the importer would consider invalid.
ALTER TABLE products
    ADD CONSTRAINT products_price_minor_non_negative CHECK (price_minor >= 0) NOT VALID;

ALTER TABLE products
    ADD CONSTRAINT products_stock_non_negative CHECK (stock >= 0) NOT VALID;

-- NOT VALID above skips the full-table scan so the ALTER takes only a brief lock; validate the
-- existing rows separately, which takes no exclusive lock.
ALTER TABLE products VALIDATE CONSTRAINT products_price_minor_non_negative;
ALTER TABLE products VALIDATE CONSTRAINT products_stock_non_negative;

-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction. Flyway must be configured with
-- `spring.flyway.mixed=true`, or this statement split into its own migration marked
-- `-- flyway:executeInTransaction=false`.
