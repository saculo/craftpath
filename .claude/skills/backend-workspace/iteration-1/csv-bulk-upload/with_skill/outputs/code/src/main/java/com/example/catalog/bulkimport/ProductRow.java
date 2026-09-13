package com.example.catalog.bulkimport;

/**
 * One CSV line after parsing and validation. Constructing this type is only
 * possible with values that already passed validation, so nothing downstream
 * has to re-check them.
 *
 * @param lineNumber 1-based physical line in the uploaded file, used only for
 *                   error reporting back to the caller.
 */
public record ProductRow(
        long lineNumber,
        String sku,
        String name,
        long priceCents,
        String currency,
        boolean active) {
}
