package com.example.orders.idempotency;

import java.util.UUID;

/**
 * Identity of one idempotent attempt.
 *
 * <p>The triple {@code (scope, principalId, key)} is the dedup identity and
 * matches the unique constraint exactly. {@code requestHash} is not part of the
 * identity — it is checked against the stored value so that a key reused with a
 * different payload is reported as a client error rather than answered with
 * someone else's order.
 */
public record IdempotencyContext(
        String scope,
        UUID principalId,
        String key,
        String requestHash) {
}
