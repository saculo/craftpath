package com.example.orders.idempotency;

/**
 * 422 — the key was already used, but with a *different* request body.
 *
 * <p>Replaying the stored response would be a lie (the caller asked for something
 * else), and executing the new body would break the key's contract. The only honest
 * answer is to refuse and tell the client its key generation is buggy.
 */
public final class IdempotencyKeyReusedException extends RuntimeException
        implements IdempotencyExceptions {

    public IdempotencyKeyReusedException(String message) {
        super(message);
    }
}
