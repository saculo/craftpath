package com.example.catalog.products.bulkimport;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Currency;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.springframework.stereotype.Component;

import com.example.catalog.products.bulkimport.BulkImportErrors.MalformedCsvException;

/**
 * Parses and fully validates a product CSV. Pure: no database, no transaction, no side effects.
 *
 * <p>Validation is exhaustive rather than fail-fast. A file with forty bad rows should be fixable
 * in one pass, which means the caller needs all forty errors, not the first one. The only
 * fail-fast cases are structural — a file that isn't a product CSV at all, or one large enough to
 * be a memory risk — where continuing would produce noise instead of information.
 */
@Component
public class ProductCsvParser {

    /** Upper bound on buffered rows. See solution.md: above this the design should stage in SQL. */
    static final int MAX_ROWS = 50_000;

    /** Beyond this the response lists examples rather than every failure. */
    static final int MAX_REPORTED_ERRORS = 100;

    private static final Pattern SKU = Pattern.compile("[A-Z0-9-]{1,64}");
    private static final int MAX_NAME_LENGTH = 200;
    private static final int MAX_DESCRIPTION_LENGTH = 4_000;
    private static final char BOM = '﻿';

    private static final List<String> HEADERS =
            List.of("sku", "name", "description", "price", "currency", "stock", "active");

    private static final CSVFormat FORMAT = CSVFormat.RFC4180.builder()
            .setHeader()
            .setSkipHeaderRecord(true)
            .setIgnoreSurroundingSpaces(true)
            .setTrim(true)
            .build();

    public CsvParseResult parse(InputStream input) {
        try (Reader reader = stripBom(new InputStreamReader(input, StandardCharsets.UTF_8));
             CSVParser parser = CSVParser.parse(reader, FORMAT)) {

            requireExpectedHeaders(parser);

            List<ProductRow> rows = new ArrayList<>();
            List<RowError> errors = new ArrayList<>();
            // Maps SKU -> first line it appeared on, so a duplicate can name its twin.
            Map<String, Long> seenSkus = new HashMap<>();
            int total = 0;

            for (CSVRecord record : parser) {
                if (++total > MAX_ROWS) {
                    throw new MalformedCsvException(
                            "file_too_large", "File exceeds the maximum of " + MAX_ROWS + " rows.");
                }
                // getCurrentLineNumber() is the last physical line of the record just read, which
                // is what an editor's "go to line" lands on for a multi-line quoted field.
                long line = parser.getCurrentLineNumber();
                requireConsistentColumns(record, line);

                List<RowError> rowErrors = new ArrayList<>();
                ProductRow row = validate(record, line, seenSkus, rowErrors);

                if (rowErrors.isEmpty()) {
                    seenSkus.put(row.sku(), line);
                    rows.add(row);
                } else {
                    errors.addAll(rowErrors);
                }
            }

            if (total == 0) {
                throw new MalformedCsvException("empty_file", "File contains a header but no rows.");
            }
            return errors.isEmpty() ? CsvParseResult.ok(rows) : CsvParseResult.rejected(errors, total);

        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (IllegalStateException e) {
            // Commons CSV signals unterminated quotes and similar lexer faults this way.
            throw new MalformedCsvException("malformed_csv", "File is not valid CSV: " + e.getMessage());
        }
    }

    private ProductRow validate(CSVRecord record, long line, Map<String, Long> seenSkus, List<RowError> errors) {
        String sku = validateSku(record.get("sku"), line, seenSkus, errors);
        String name = validateName(record.get("name"), line, errors);
        String description = validateDescription(record.get("description"), line, errors);
        long priceMinor = validatePrice(record.get("price"), line, errors);
        String currency = validateCurrency(record.get("currency"), line, errors);
        int stock = validateStock(record.get("stock"), line, errors);
        boolean active = validateActive(record.get("active"), line, errors);

        return errors.isEmpty()
                ? new ProductRow(line, sku, name, description, priceMinor, currency, stock, active)
                : null;
    }

    private String validateSku(String raw, long line, Map<String, Long> seenSkus, List<RowError> errors) {
        if (isBlank(raw)) {
            errors.add(RowError.of(line, "sku", raw, "is required"));
            return null;
        }
        String sku = raw.toUpperCase();
        if (!SKU.matcher(sku).matches()) {
            errors.add(RowError.of(line, "sku", raw, "must be 1-64 characters of A-Z, 0-9 or '-'"));
            return null;
        }
        Long firstSeen = seenSkus.get(sku);
        if (firstSeen != null) {
            // The unique index would also catch this, but only as an opaque batch failure with no
            // way to say which two lines collided. That message is the whole point of checking here.
            errors.add(RowError.of(line, "sku", raw, "duplicate of line " + firstSeen));
            return null;
        }
        return sku;
    }

    private String validateName(String raw, long line, List<RowError> errors) {
        if (isBlank(raw)) {
            errors.add(RowError.of(line, "name", raw, "is required"));
            return null;
        }
        if (raw.length() > MAX_NAME_LENGTH) {
            errors.add(RowError.of(line, "name", raw, "must be at most " + MAX_NAME_LENGTH + " characters"));
            return null;
        }
        return raw;
    }

    private String validateDescription(String raw, long line, List<RowError> errors) {
        if (raw != null && raw.length() > MAX_DESCRIPTION_LENGTH) {
            errors.add(RowError.of(line, "description", raw,
                    "must be at most " + MAX_DESCRIPTION_LENGTH + " characters"));
            return null;
        }
        return isBlank(raw) ? null : raw;
    }

    private long validatePrice(String raw, long line, List<RowError> errors) {
        if (isBlank(raw)) {
            errors.add(RowError.of(line, "price", raw, "is required"));
            return 0L;
        }
        BigDecimal price;
        try {
            price = new BigDecimal(raw);
        } catch (NumberFormatException e) {
            errors.add(RowError.of(line, "price", raw, "must be a decimal number, e.g. 12.34"));
            return 0L;
        }
        if (price.signum() < 0) {
            errors.add(RowError.of(line, "price", raw, "must be >= 0"));
            return 0L;
        }
        if (price.scale() > 2) {
            errors.add(RowError.of(line, "price", raw, "must have at most 2 decimal places"));
            return 0L;
        }
        try {
            // NOTE: assumes 2 minor units for every currency. Wrong for JPY/KWD — see user_notes.md.
            return price.movePointRight(2).longValueExact();
        } catch (ArithmeticException e) {
            errors.add(RowError.of(line, "price", raw, "is too large"));
            return 0L;
        }
    }

    private String validateCurrency(String raw, long line, List<RowError> errors) {
        if (isBlank(raw)) {
            errors.add(RowError.of(line, "currency", raw, "is required"));
            return null;
        }
        String code = raw.toUpperCase();
        try {
            Currency.getInstance(code);
            return code;
        } catch (IllegalArgumentException e) {
            errors.add(RowError.of(line, "currency", raw, "must be a 3-letter ISO-4217 code"));
            return null;
        }
    }

    private int validateStock(String raw, long line, List<RowError> errors) {
        if (isBlank(raw)) {
            errors.add(RowError.of(line, "stock", raw, "is required"));
            return 0;
        }
        try {
            int stock = Integer.parseInt(raw);
            if (stock < 0) {
                errors.add(RowError.of(line, "stock", raw, "must be >= 0"));
            }
            return stock;
        } catch (NumberFormatException e) {
            errors.add(RowError.of(line, "stock", raw, "must be a whole number"));
            return 0;
        }
    }

    private boolean validateActive(String raw, long line, List<RowError> errors) {
        if (isBlank(raw)) {
            return true; // optional, defaults to active
        }
        if ("true".equalsIgnoreCase(raw)) {
            return true;
        }
        if ("false".equalsIgnoreCase(raw)) {
            return false;
        }
        errors.add(RowError.of(line, "active", raw, "must be true or false"));
        return true;
    }

    private void requireExpectedHeaders(CSVParser parser) {
        Set<String> actual = new LinkedHashSet<>(parser.getHeaderNames());
        Set<String> expected = new LinkedHashSet<>(HEADERS);
        if (!actual.equals(expected)) {
            List<String> missing = HEADERS.stream().filter(h -> !actual.contains(h)).toList();
            List<String> unknown = actual.stream().filter(h -> !expected.contains(h)).toList();
            throw new MalformedCsvException("bad_header",
                    "Header must be exactly %s. Missing: %s. Unexpected: %s."
                            .formatted(HEADERS, missing, unknown));
        }
    }

    private void requireConsistentColumns(CSVRecord record, long line) {
        if (!record.isConsistent()) {
            throw new MalformedCsvException("bad_row_shape",
                    "Line %d has %d fields but the header declares %d."
                            .formatted(line, record.size(), HEADERS.size()));
        }
    }

    /** Excel writes a UTF-8 BOM; left in place it becomes part of the first header name. */
    private static Reader stripBom(Reader reader) throws IOException {
        BufferedReader buffered = new BufferedReader(reader);
        buffered.mark(1);
        if (buffered.read() != BOM) {
            buffered.reset();
        }
        return buffered;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
