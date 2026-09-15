-- Idempotency ledger for unsafe POST endpoints.
--
-- One row per (scope, key). The row is written in the SAME transaction as the
-- business effect, so "an order exists" and "we recorded that we created it"
-- can never disagree.

CREATE TABLE idempotency_key (
    scope             text        NOT NULL,   -- e.g. 'POST /orders'
    owner_id          uuid        NOT NULL,   -- authenticated principal; keys are namespaced per caller
    idempotency_key   text        NOT NULL,   -- client-generated, opaque to us

    request_fingerprint bytea     NOT NULL,   -- sha-256 of the canonical request body
    response_status   smallint    NOT NULL,
    response_body     jsonb       NOT NULL,

    -- Useful for support/debugging: which order did this key produce.
    resource_id       uuid,

    created_at        timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT idempotency_key_pk PRIMARY KEY (scope, owner_id, idempotency_key),
    CONSTRAINT idempotency_key_len CHECK (length(idempotency_key) BETWEEN 8 AND 200)
);

-- Retention sweep support (see IdempotencyCleanupJob).
CREATE INDEX idempotency_key_created_at_idx ON idempotency_key (created_at);

-- Defence in depth ONLY. This is not the dedupe mechanism; it is a tripwire that
-- turns a logic bug into a constraint violation instead of a duplicate order.
-- It is deliberately *not* a uniqueness rule on cart contents, because a customer
-- legitimately re-ordering the same basket must be allowed.
ALTER TABLE orders
    ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX orders_owner_idempotency_key_uidx
    ON orders (customer_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
