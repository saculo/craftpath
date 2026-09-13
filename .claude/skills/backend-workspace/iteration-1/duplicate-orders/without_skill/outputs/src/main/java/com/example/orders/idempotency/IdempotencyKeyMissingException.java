package com.example.orders.idempotency;

/** 400 — the caller did not supply a usable {@code Idempotency-Key}. */
public final class IdempotencyKeyMissingException extends RuntimeException
        implements IdempotencyExceptions {

    public IdempotencyKeyMissingException(String message) {
        super(message);
    }
}
