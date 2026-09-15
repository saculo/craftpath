package com.example.catalog.products.bulkimport;

/**
 * One field-level validation failure, addressed by the line number the uploader sees in their
 * editor rather than by record index (the two differ once a quoted field contains a newline).
 *
 * @param line    physical line number in the uploaded file, 1-based
 * @param field   CSV column name
 * @param value   the offending value, truncated for safety before it reaches a response
 * @param message human-readable reason, phrased as the rule that was broken
 */
public record RowError(long line, String field, String value, String message) {

    private static final int MAX_ECHOED_VALUE = 80;

    public static RowError of(long line, String field, String value, String message) {
        return new RowError(line, field, truncate(value), message);
    }

    private static String truncate(String value) {
        if (value == null) {
            return null;
        }
        return value.length() <= MAX_ECHOED_VALUE ? value : value.substring(0, MAX_ECHOED_VALUE) + "…";
    }
}
