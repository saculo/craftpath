package com.example.catalog.bulkimport;

/**
 * A single machine-readable reason a row was rejected.
 *
 * <p>{@code code} is part of the API contract: callers branch on it. {@code message}
 * is for humans and may be reworded without it counting as a breaking change.
 * Neither ever carries an exception message, SQL, or stack detail.
 */
public record RowError(long line, String field, String code, String message) {

    public static RowError of(long line, String field, String code, String message) {
        return new RowError(line, field, code, message);
    }
}
