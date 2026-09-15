package com.example.orders.idempotency;

/** Marker for the (small) family of idempotency failures the API surfaces. */
public sealed interface IdempotencyExceptions
        permits IdempotencyKeyMissingException, IdempotencyKeyReusedException, IdempotencyInProgressException {
}
