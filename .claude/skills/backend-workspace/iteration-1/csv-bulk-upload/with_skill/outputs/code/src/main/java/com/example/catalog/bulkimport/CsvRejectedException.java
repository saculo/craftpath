package com.example.catalog.bulkimport;

import java.util.List;

/**
 * Thrown when the uploaded file is not acceptable. Always thrown <em>before</em>
 * any write occurs, so it carries an implicit guarantee: nothing was persisted.
 */
public class CsvRejectedException extends RuntimeException {

    private final String code;
    private final List<RowError> errors;
    private final long totalErrorCount;

    public CsvRejectedException(String code, String message, List<RowError> errors, long totalErrorCount) {
        super(message);
        this.code = code;
        this.errors = List.copyOf(errors);
        this.totalErrorCount = totalErrorCount;
    }

    public static CsvRejectedException file(String code, String message) {
        return new CsvRejectedException(code, message, List.of(), 0);
    }

    public String code() {
        return code;
    }

    /** Reported errors; may be truncated relative to {@link #totalErrorCount()}. */
    public List<RowError> errors() {
        return errors;
    }

    public long totalErrorCount() {
        return totalErrorCount;
    }
}
