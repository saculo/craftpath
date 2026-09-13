package com.example.orders.idempotency;

import java.util.UUID;

/**
 * A row of {@code idempotency_key} as the application needs it.
 *
 * <p>{@code responseBody} is the stored JSON text, replayed verbatim so a retry
 * receives byte-for-byte what the original call received. Re-serializing from a
 * domain object would let a later code change quietly alter the answer given to
 * an old retry.
 */
public record IdempotencyRecord(
        String requestHash,
        State state,
        Integer responseStatus,
        String responseBody,
        UUID resourceId) {

    public enum State { IN_PROGRESS, COMPLETED }

    public boolean isCompleted() {
        return state == State.COMPLETED;
    }
}
