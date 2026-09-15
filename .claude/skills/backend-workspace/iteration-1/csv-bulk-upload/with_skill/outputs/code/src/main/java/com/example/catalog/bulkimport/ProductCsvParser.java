package com.example.catalog.bulkimport;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.Reader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Currency;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Parses and validates the whole file before anything is written.
 *
 * <p>This class touches no database and performs no side effects, which is what
 * makes the "reject the whole file" rule cheap to enforce: validation completes,
 * in full, before a transaction is ever opened.
 */
@Component
public class ProductCsvParser {

    /** Exact header the file must carry, in this order. */
    static final List<String> REQUIRED_HEADER = List.of("sku", "name", "price_cents", "currency", "active");

    /** Hard cap on rows, so one upload cannot exhaust heap or hold a long transaction. */
    static final int MAX_ROWS = 50_000;

    /** Errors beyond this are counted but not returned, to bound the response body. */
    static final int MAX_REPORTED_ERRORS = 100;

    private static final Pattern SKU = Pattern.compile("^[A-Z0-9][A-Z0-9-]{2,31}$");
    private static final int MAX_NAME_LENGTH = 200;
    private static final long MAX_PRICE_CENTS = 100_000_000L;
    private static final Set<String> TRUE_VALUES = Set.of("true", "yes", "1");
    private static final Set<String> FALSE_VALUES = Set.of("false", "no", "0");
    private static final char BOM = '﻿';

    /**
     * @return every row, in file order, all of them valid
     * @throws CsvRejectedException if the header is wrong, the file is empty, the row
     *                              limit is exceeded, the file is not parseable, or
     *                              <em>any</em> row fails validation
     */
    public List<ProductRow> parse(InputStream in) {
        CSVFormat format = CSVFormat.DEFAULT.builder()
                .setHeader()
                .setSkipHeaderRecord(true)
                .setIgnoreSurroundingSpaces(true)
                .setIgnoreEmptyLines(true)
                .setTrim(true)
                .build();

        List<ProductRow> rows = new ArrayList<>();
        Errors errors = new Errors();
        // sku -> line it first appeared on, so a duplicate can name both lines.
        Map<String, Long> firstSeenLine = new HashMap<>();

        try (Reader reader = new InputStreamReader(in, StandardCharsets.UTF_8);
             CSVParser parser = CSVParser.parse(reader, format)) {

            requireExactHeader(parser.getHeaderNames());

            for (CSVRecord record : parser) {
                if (record.getRecordNumber() > MAX_ROWS) {
                    throw CsvRejectedException.file(
                            "too_many_rows",
                            "File exceeds the maximum of " + MAX_ROWS + " data rows.");
                }
                long line = record.getRecordNumber() + 1; // +1 for the header line

                if (!record.isConsistent()) {
                    errors.add(RowError.of(line, null, "column_count_mismatch",
                            "Row has " + record.size() + " columns, expected " + REQUIRED_HEADER.size() + "."));
                    continue;
                }

                ProductRow row = validate(record, line, firstSeenLine, errors);
                if (row != null) {
                    firstSeenLine.put(row.sku(), line);
                    rows.add(row);
                }
            }
        } catch (IllegalArgumentException | IOException | UncheckedIOException e) {
            // Malformed quoting, bad encoding, truncated upload. The caller gets a stable
            // code; the detail is logged at the boundary rather than returned.
            throw CsvRejectedException.file("csv_unparseable", "The file could not be parsed as CSV.");
        }

        if (rows.isEmpty() && errors.isEmpty()) {
            throw CsvRejectedException.file("empty_file", "The file contains a header but no data rows.");
        }
        if (!errors.isEmpty()) {
            throw new CsvRejectedException(
                    "csv_validation_failed",
                    "The file was rejected; no products were imported.",
                    errors.reported(),
                    errors.total());
        }
        return rows;
    }

    private void requireExactHeader(List<String> header) {
        List<String> normalised = new ArrayList<>(header.size());
        for (String column : header) {
            String value = column == null ? "" : column.trim().toLowerCase(Locale.ROOT);
            // Spreadsheet exports attach a UTF-8 BOM to the first cell.
            if (!value.isEmpty() && value.charAt(0) == BOM) {
                value = value.substring(1);
            }
            normalised.add(value);
        }
        if (!REQUIRED_HEADER.equals(normalised)) {
            throw CsvRejectedException.file(
                    "invalid_header",
                    "Expected header: " + String.join(",", REQUIRED_HEADER) + ".");
        }
    }

    /**
     * Collects every problem with the row rather than returning on the first, so a
     * caller fixing a broken export sees the whole picture in one round trip.
     *
     * @return the validated row, or {@code null} if it produced at least one error
     */
    private ProductRow validate(CSVRecord record, long line, Map<String, Long> firstSeenLine, Errors errors) {
        boolean valid = true;

        String sku = record.get("sku");
        if (sku.isEmpty()) {
            valid = errors.add(RowError.of(line, "sku", "required", "sku is required."));
        } else if (!SKU.matcher(sku).matches()) {
            valid = errors.add(RowError.of(line, "sku", "invalid_format",
                    "sku must be 3-32 characters of A-Z, 0-9 or '-'."));
        } else if (firstSeenLine.containsKey(sku)) {
            // A duplicate *within* the file would otherwise surface as an opaque
            // constraint violation mid-batch, so it is caught here by name and line.
            valid = errors.add(RowError.of(line, "sku", "duplicate_in_file",
                    "sku '" + sku + "' already appears on line " + firstSeenLine.get(sku) + "."));
        }

        String name = record.get("name");
        if (name.isEmpty()) {
            valid = errors.add(RowError.of(line, "name", "required", "name is required."));
        } else if (name.length() > MAX_NAME_LENGTH) {
            valid = errors.add(RowError.of(line, "name", "too_long",
                    "name must be at most " + MAX_NAME_LENGTH + " characters."));
        }

        long priceCents = 0;
        String rawPrice = record.get("price_cents");
        if (rawPrice.isEmpty()) {
            valid = errors.add(RowError.of(line, "price_cents", "required", "price_cents is required."));
        } else {
            try {
                priceCents = Long.parseLong(rawPrice);
                if (priceCents < 0 || priceCents > MAX_PRICE_CENTS) {
                    valid = errors.add(RowError.of(line, "price_cents", "out_of_range",
                            "price_cents must be between 0 and " + MAX_PRICE_CENTS + "."));
                }
            } catch (NumberFormatException e) {
                valid = errors.add(RowError.of(line, "price_cents", "not_an_integer",
                        "price_cents must be a whole number of minor units."));
            }
        }

        String currency = record.get("currency").toUpperCase(Locale.ROOT);
        if (currency.isEmpty()) {
            valid = errors.add(RowError.of(line, "currency", "required", "currency is required."));
        } else if (!isKnownCurrency(currency)) {
            valid = errors.add(RowError.of(line, "currency", "unknown_currency",
                    "currency must be a 3-letter ISO 4217 code."));
        }

        boolean active = true;
        String rawActive = record.get("active");
        if (!rawActive.isEmpty()) {
            String lower = rawActive.toLowerCase(Locale.ROOT);
            if (TRUE_VALUES.contains(lower)) {
                active = true;
            } else if (FALSE_VALUES.contains(lower)) {
                active = false;
            } else {
                valid = errors.add(RowError.of(line, "active", "not_a_boolean",
                        "active must be one of true/false/yes/no/1/0, or blank."));
            }
        }

        return valid ? new ProductRow(line, sku, name, priceCents, currency, active) : null;
    }

    private static boolean isKnownCurrency(String code) {
        try {
            Currency.getInstance(code);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    /** Counts every error but retains only the first {@link #MAX_REPORTED_ERRORS}. */
    private static final class Errors {

        private final List<RowError> reported = new ArrayList<>();
        private long total;

        /** @return always {@code false}, so call sites can write {@code valid = errors.add(...)} */
        boolean add(RowError error) {
            total++;
            if (reported.size() < MAX_REPORTED_ERRORS) {
                reported.add(error);
            }
            return false;
        }

        boolean isEmpty() {
            return total == 0;
        }

        long total() {
            return total;
        }

        List<RowError> reported() {
            return reported;
        }
    }
}
