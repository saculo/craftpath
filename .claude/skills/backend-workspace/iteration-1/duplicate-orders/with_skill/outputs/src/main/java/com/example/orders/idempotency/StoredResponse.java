package com.example.orders.idempotency;

import java.util.UUID;

/**
 * The response recorded for an idempotent attempt, and the thing replayed to a
 * retry.
 *
 * @param status     HTTP status the original call returned
 * @param body       serialized JSON body, replayed verbatim
 * @param resourceId created resource, used to rebuild the {@code Location} header
 * @param replayed   {@code false} for the call that did the work, {@code true}
 *                   for every retry answered from the stored row
 */
public record StoredResponse(int status, String body, UUID resourceId, boolean replayed) {

    public StoredResponse asReplay() {
        return new StoredResponse(status, body, resourceId, true);
    }
}
