-- Transactional outbox.
--
-- Dedup at the HTTP boundary only protects what is inside the database
-- transaction. Payment capture, confirmation email and downstream events are
-- not. Recording intent here, in the same transaction as the order, is what
-- stops a retried request from producing a second charge or a second email:
-- the retry rolls back and takes its outbox row with it.

CREATE TABLE order_outbox (
    id             bigserial   PRIMARY KEY,
    order_id       uuid        NOT NULL,
    event_type     text        NOT NULL,
    payload        jsonb       NOT NULL,

    -- PENDING -> PUBLISHED | FAILED. FAILED is terminal and visible, so an
    -- exhausted event is discoverable without reading logs.
    status         text        NOT NULL DEFAULT 'PENDING',
    attempts       integer     NOT NULL DEFAULT 0,
    last_error     text,

    created_at     timestamptz NOT NULL DEFAULT now(),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    published_at   timestamptz,

    CONSTRAINT order_outbox_status_valid
        CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED'))
);

-- The relay's claim query: oldest due PENDING rows first.
CREATE INDEX order_outbox_due_idx
    ON order_outbox (next_attempt_at)
    WHERE status = 'PENDING';

-- Cheap alerting query: "is anything stuck?"
CREATE INDEX order_outbox_failed_idx
    ON order_outbox (created_at)
    WHERE status = 'FAILED';
