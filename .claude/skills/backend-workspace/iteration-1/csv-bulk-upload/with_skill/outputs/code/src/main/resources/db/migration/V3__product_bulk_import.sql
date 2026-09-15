-- Step 1 of an expand-only migration: adds new structure, changes nothing existing.
-- Safe to deploy before or after the code that uses it.

CREATE TABLE IF NOT EXISTS product (
    id           BIGSERIAL    PRIMARY KEY,
    sku          TEXT         NOT NULL,
    name         TEXT         NOT NULL,
    price_cents  BIGINT       NOT NULL,
    currency     CHAR(3)      NOT NULL,
    active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- The database, not the application, is what makes "sku is unique" true.
    -- An application-side pre-check races; this constraint does not.
    CONSTRAINT product_sku_key UNIQUE (sku),
    CONSTRAINT product_price_cents_non_negative CHECK (price_cents >= 0),
    CONSTRAINT product_name_not_blank CHECK (length(btrim(name)) > 0)
);

-- Records the intent and outcome of each bulk import, so a retried upload is
-- detectable and an import is auditable without reading logs.
CREATE TABLE IF NOT EXISTS product_import (
    id               UUID         PRIMARY KEY,
    idempotency_key  TEXT         NOT NULL,
    file_sha256      CHAR(64)     NOT NULL,
    row_count        INTEGER      NOT NULL,
    inserted_count   INTEGER      NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT product_import_idempotency_key_key UNIQUE (idempotency_key),
    CONSTRAINT product_import_row_count_non_negative CHECK (row_count >= 0)
);

-- The import row is written in the same transaction as the products it created,
-- so a committed import row always implies its products are present.
ALTER TABLE product
    ADD COLUMN IF NOT EXISTS import_id UUID REFERENCES product_import (id);

CREATE INDEX IF NOT EXISTS product_import_id_idx ON product (import_id);
