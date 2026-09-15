-- Deduplication record for unsafe POST endpoints.
--
-- One row per (endpoint, caller, client-supplied key). The unique constraint is
-- what actually makes concurrent retries safe; everything in the application is
-- built on top of it, not in place of it.

CREATE TABLE idempotency_key (
    id               bigserial   PRIMARY KEY,

    -- Endpoint identity. Keys are scoped so that reusing the same key against a
    -- different operation is not silently treated as a retry.
    scope            text        NOT NULL,

    -- Authenticated caller. Scoping by principal stops one tenant's key from
    -- colliding with another's, and stops a guessed key from leaking another
    -- caller's stored response body.
    principal_id     uuid        NOT NULL,

    idempotency_key  text        NOT NULL,

    -- SHA-256 over the canonical form of the request payload. Detects a client
    -- reusing a key for a genuinely different request, which is a client bug we
    -- want to surface loudly rather than answer with the wrong order.
    request_hash     text        NOT NULL,

    -- IN_PROGRESS -> COMPLETED. With the single-transaction flow a row is only
    -- ever visible to other transactions as COMPLETED; IN_PROGRESS becomes
    -- observable if/when the two-phase variant is adopted for endpoints that
    -- call out to another system mid-request.
    state            text        NOT NULL,

    response_status  integer,
    response_body    jsonb,
    resource_id      uuid,

    created_at       timestamptz NOT NULL DEFAULT now(),
    completed_at     timestamptz,
    expires_at       timestamptz NOT NULL,

    CONSTRAINT idempotency_key_state_valid
        CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),

    -- A COMPLETED row must be replayable. Without this a bug that forgets to
    -- record the response produces rows that dedupe the write but cannot answer
    -- the retry, which is worse than no dedup at all.
    CONSTRAINT idempotency_key_completed_is_replayable
        CHECK (state <> 'COMPLETED'
               OR (response_status IS NOT NULL AND response_body IS NOT NULL)),

    CONSTRAINT idempotency_key_unique
        UNIQUE (scope, principal_id, idempotency_key)
);

-- Supports the expiry reaper's range delete.
CREATE INDEX idempotency_key_expires_at_idx ON idempotency_key (expires_at);

COMMENT ON TABLE idempotency_key IS
    'Dedup + stored response for retried unsafe requests. Rows are disposable '
    'after expires_at; deleting one only means a later retry with the same key '
    'would be treated as a new request.';
