package com.example.catalog.bulkimport;

import java.util.UUID;

/**
 * Success response body.
 *
 * @param replayed true when this exact upload was already imported under the same
 *                 Idempotency-Key, so the call was a no-op. Callers use it to tell
 *                 "I imported 500 products" from "those 500 were already there".
 */
public record ImportSummary(UUID importId, int rowCount, int insertedCount, boolean replayed) {
}
