package com.example.orders.idempotency;

import java.util.UUID;

/**
 * The response we durably associate with an idempotency key.
 *
 * @param status       HTTP status to replay
 * @param bodyJson     serialized response body (stored as jsonb)
 * @param resourceId   the created/affected resource, for support queries; may be null
 */
public record StoredResponse(int status, String bodyJson, UUID resourceId) {
}
