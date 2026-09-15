package com.example.orders.api;

import java.util.UUID;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * Resolves the authenticated caller.
 *
 * <p>Idempotency keys are scoped to this value, so it must come from the
 * authenticated principal and never from a request field. A client-supplied
 * caller id would let one account probe or collide with another account's keys,
 * and the stored response body would be readable by whoever guessed the key.
 */
@Component
public class CurrentCaller {

    public UUID id() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new IllegalStateException("no authenticated principal on the security context");
        }
        return UUID.fromString(authentication.getName());
    }
}
