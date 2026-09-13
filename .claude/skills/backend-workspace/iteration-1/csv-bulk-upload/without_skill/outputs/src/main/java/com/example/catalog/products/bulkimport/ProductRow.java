package com.example.catalog.products.bulkimport;

/**
 * A single CSV row that has already passed validation.
 *
 * <p>Construction of this type is the validation boundary: if you hold one, its contents are
 * known-good and the only remaining failure mode is a database constraint. Money is carried as
 * minor units ({@code 12.34 EUR} -> {@code 1234}, {@code "EUR"}) so that no floating point type
 * touches the price on any path.
 *
 * @param line physical line number in the uploaded file, retained for error reporting
 */
public record ProductRow(
        long line,
        String sku,
        String name,
        String description,
        long priceMinor,
        String currency,
        int stock,
        boolean active) {
}
