package com.example.orders.idempotency;

/**
 * 409 — a request with this key is still running and we gave up waiting for it.
 *
 * <p>Emitted when the row lock wait exceeds {@code lock_timeout}. The client should
 * retry the identical request (same key) after a short backoff; it will then either
 * block briefly or get the replayed response.
 */
public final class IdempotencyInProgressException extends RuntimeException
        implements IdempotencyExceptions {

    public IdempotencyInProgressException(String message, Throwable cause) {
        super(message, cause);
    }
}
