package com.example.orders.idempotency;

import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Plain JDBC on purpose.
 *
 * <p>With JPA, the INSERT would be deferred to flush time, which means the unique
 * violation surfaces at an unpredictable point (often at commit, wrapped, with the
 * persistence context already poisoned). We need the constraint to fire at a known
 * statement so the caller can reason about it.
 */
@Repository
public class IdempotencyRepository {

    private final JdbcClient jdbc;

    public IdempotencyRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Claims the key and records the outcome in one statement.
     *
     * <p>Throws {@link org.springframework.dao.DuplicateKeyException} if another
     * transaction already committed this key. If another transaction holds the key
     * but has not committed, this call <em>blocks</em> on the index tuple until that
     * transaction ends — which is exactly the serialization we want.
     */
    public void insert(IdempotencyScope scope, byte[] fingerprint, StoredResponse response) {
        jdbc.sql("""
                INSERT INTO idempotency_key
                    (scope, owner_id, idempotency_key, request_fingerprint,
                     response_status, response_body, resource_id)
                VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)
                """)
                .params(scope.scope(), scope.ownerId(), scope.key(), fingerprint,
                        response.status(), response.bodyJson(), response.resourceId())
                .update();
    }

    public Optional<IdempotencyRecord> find(IdempotencyScope scope) {
        return jdbc.sql("""
                SELECT request_fingerprint, response_status, response_body, resource_id
                  FROM idempotency_key
                 WHERE scope = ? AND owner_id = ? AND idempotency_key = ?
                """)
                .params(scope.scope(), scope.ownerId(), scope.key())
                .query((rs, n) -> new IdempotencyRecord(
                        rs.getBytes("request_fingerprint"),
                        new StoredResponse(
                                rs.getInt("response_status"),
                                rs.getString("response_body"),
                                rs.getObject("resource_id", UUID.class))))
                .optional();
    }

    /** Bounds how long a retry will block behind an in-flight sibling request. */
    public void setLockTimeout(String timeout) {
        jdbc.sql("SET LOCAL lock_timeout = " + quote(timeout)).update();
    }

    public int deleteOlderThan(java.time.Duration retention) {
        return jdbc.sql("DELETE FROM idempotency_key WHERE created_at < now() - ?::interval")
                .param(retention.toSeconds() + " seconds")
                .update();
    }

    private static String quote(String literal) {
        if (!literal.matches("[0-9]+(ms|s)")) {
            throw new IllegalArgumentException("unsupported timeout literal: " + literal);
        }
        return "'" + literal + "'";
    }

    public record IdempotencyRecord(byte[] requestFingerprint, StoredResponse response) {
    }
}
