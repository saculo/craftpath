package com.example.orders.idempotency;

import java.util.UUID;

/**
 * Identifies one logical idempotent operation attempt.
 *
 * <p>Keys are namespaced by {@code scope} (the endpoint) and {@code ownerId} (the
 * authenticated principal). Namespacing by owner matters: a client-generated key is
 * only unique within that client, and without the owner in the primary key one
 * tenant could probe or collide with another tenant's keys.
 */
public record IdempotencyScope(String scope, UUID ownerId, String key) {

    public IdempotencyScope {
        if (scope == null || scope.isBlank()) {
            throw new IllegalArgumentException("scope is required");
        }
        if (ownerId == null) {
            throw new IllegalArgumentException("ownerId is required");
        }
        if (key == null || key.length() < 8 || key.length() > 200) {
            throw new IdempotencyKeyMissingException(
                    "Idempotency-Key header must be present and 8..200 characters");
        }
    }
}
