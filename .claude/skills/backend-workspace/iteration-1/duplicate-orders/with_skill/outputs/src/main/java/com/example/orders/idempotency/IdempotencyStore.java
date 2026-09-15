package com.example.orders.idempotency;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Data access for {@code idempotency_key}.
 *
 * <p>Deliberately plain JDBC rather than JPA: the claim below depends on the
 * exact statement Postgres runs and on when it runs. A JPA persist would be
 * flushed at an unpredictable point, which is the difference between detecting
 * a conflict before doing the work and detecting it after.
 */
@Repository
public class IdempotencyStore {

    private final JdbcTemplate jdbc;
    private final Duration retention;

    public IdempotencyStore(JdbcTemplate jdbc, IdempotencyProperties properties) {
        this.jdbc = jdbc;
        this.retention = properties.retention();
    }

    /**
     * Attempts to claim the key for the current transaction.
     *
     * <p>{@code ON CONFLICT DO NOTHING} is doing real work here. If another
     * transaction is mid-flight with the same key, Postgres makes this statement
     * wait on that transaction rather than returning immediately — so the loser
     * of a race finds out the truth (committed, or rolled back and the key is
     * free) instead of guessing. It returns 0 rows only once the winner has
     * actually committed.
     *
     * @return {@code true} if this call owns the key, {@code false} if a
     *         committed row already exists
     */
    public boolean tryClaim(IdempotencyContext context) {
        int inserted = jdbc.update("""
                INSERT INTO idempotency_key
                    (scope, principal_id, idempotency_key, request_hash, state, expires_at)
                VALUES (?, ?, ?, ?, 'IN_PROGRESS', ?)
                ON CONFLICT (scope, principal_id, idempotency_key) DO NOTHING
                """,
                context.scope(),
                context.principalId(),
                context.key(),
                context.requestHash(),
                java.sql.Timestamp.from(Instant.now().plus(retention)));
        return inserted == 1;
    }

    /** Records the outcome so the next retry can be answered without re-doing the work. */
    public void complete(IdempotencyContext context, StoredResponse response) {
        jdbc.update("""
                UPDATE idempotency_key
                   SET state           = 'COMPLETED',
                       response_status = ?,
                       response_body   = ?::jsonb,
                       resource_id     = ?,
                       completed_at    = now()
                 WHERE scope = ? AND principal_id = ? AND idempotency_key = ?
                """,
                response.status(),
                response.body(),
                response.resourceId(),
                context.scope(),
                context.principalId(),
                context.key());
    }

    public Optional<IdempotencyRecord> find(IdempotencyContext context) {
        return jdbc.query("""
                SELECT request_hash, state, response_status, response_body, resource_id
                  FROM idempotency_key
                 WHERE scope = ? AND principal_id = ? AND idempotency_key = ?
                """,
                (rs, rowNum) -> new IdempotencyRecord(
                        rs.getString("request_hash"),
                        IdempotencyRecord.State.valueOf(rs.getString("state")),
                        (Integer) rs.getObject("response_status"),
                        rs.getString("response_body"),
                        (UUID) rs.getObject("resource_id")),
                context.scope(), context.principalId(), context.key())
                .stream().findFirst();
    }

    /** Deletes a bounded batch of expired rows; see {@link IdempotencyKeyReaper}. */
    public int deleteExpiredBatch(int limit) {
        return jdbc.update("""
                DELETE FROM idempotency_key
                 WHERE id IN (SELECT id FROM idempotency_key
                               WHERE expires_at < now()
                               ORDER BY expires_at
                               LIMIT ?)
                """, limit);
    }
}
