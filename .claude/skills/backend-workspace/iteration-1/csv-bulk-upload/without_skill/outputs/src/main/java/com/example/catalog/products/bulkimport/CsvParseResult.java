package com.example.catalog.products.bulkimport;

import java.util.List;

/**
 * Outcome of parsing and validating a whole file.
 *
 * <p>Deliberately either-shaped: when {@link #errors()} is non-empty, {@link #rows()} must not be
 * used. The file is all-or-nothing, so a partially valid parse has no meaning — the only thing a
 * caller may do with a failed result is report it.
 *
 * @param rows       validated rows, empty when the file was rejected
 * @param errors     every validation failure found, in line order
 * @param totalRows  number of data rows read, reported even on rejection so the uploader can tell
 *                   a truncated upload from a bad one
 */
public record CsvParseResult(List<ProductRow> rows, List<RowError> errors, int totalRows) {

    public CsvParseResult {
        rows = List.copyOf(rows);
        errors = List.copyOf(errors);
    }

    public boolean rejected() {
        return !errors.isEmpty();
    }

    static CsvParseResult ok(List<ProductRow> rows) {
        return new CsvParseResult(rows, List.of(), rows.size());
    }

    static CsvParseResult rejected(List<RowError> errors, int totalRows) {
        return new CsvParseResult(List.of(), errors, totalRows);
    }
}
