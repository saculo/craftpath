package com.example.catalog.bulkimport;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * Unit tests for validation rules. These are fast and have no database, because
 * every rejection rule is decided before the database is involved at all.
 */
class ProductCsvParserTest {

    private static final String HEADER = "sku,name,price_cents,currency,active\n";

    private final ProductCsvParser parser = new ProductCsvParser();

    private List<ProductRow> parse(String csv) {
        return parser.parse(new ByteArrayInputStream(csv.getBytes(StandardCharsets.UTF_8)));
    }

    private CsvRejectedException rejectionOf(String csv) {
        return catchThrowableOfType(() -> parse(csv), CsvRejectedException.class);
    }

    @Nested
    @DisplayName("a well-formed file")
    class WellFormed {

        @Test
        void parsesEveryRowInFileOrder() {
            List<ProductRow> rows = parse(HEADER + """
                    WIDGET-1,Small widget,1250,EUR,true
                    WIDGET-2,Large widget,9900,USD,false
                    """);

            assertThat(rows).extracting(ProductRow::sku).containsExactly("WIDGET-1", "WIDGET-2");
            assertThat(rows.get(0))
                    .returns(1250L, ProductRow::priceCents)
                    .returns("EUR", ProductRow::currency)
                    .returns(true, ProductRow::active);
            assertThat(rows.get(1).active()).isFalse();
        }

        @Test
        void defaultsActiveToTrueWhenTheColumnIsBlank() {
            assertThat(parse(HEADER + "WIDGET-1,Small widget,1250,EUR,\n"))
                    .singleElement()
                    .returns(true, ProductRow::active);
        }

        @Test
        void acceptsZeroAsAPrice() {
            assertThat(parse(HEADER + "FREEBIE-1,Sample,0,EUR,true\n"))
                    .singleElement()
                    .returns(0L, ProductRow::priceCents);
        }

        @Test
        void acceptsQuotedFieldsContainingCommas() {
            assertThat(parse(HEADER + "WIDGET-1,\"Widget, large\",1250,EUR,true\n"))
                    .singleElement()
                    .returns("Widget, large", ProductRow::name);
        }

        @Test
        void acceptsALeadingByteOrderMark() {
            assertThat(parse("﻿" + HEADER + "WIDGET-1,Small widget,1250,EUR,true\n"))
                    .hasSize(1);
        }
    }

    @Nested
    @DisplayName("a file rejected as a whole")
    class WholeFileRejections {

        @Test
        void rejectsAMissingOrReorderedHeader() {
            assertThatThrownBy(() -> parse("name,sku,price_cents,currency,active\n"))
                    .isInstanceOf(CsvRejectedException.class)
                    .extracting("code").isEqualTo("invalid_header");
        }

        @Test
        void rejectsAFileWithAHeaderButNoRows() {
            assertThat(rejectionOf(HEADER).code()).isEqualTo("empty_file");
        }

        @Test
        void rejectsAFileWithMoreRowsThanTheLimit() {
            StringBuilder csv = new StringBuilder(HEADER);
            for (int i = 0; i <= ProductCsvParser.MAX_ROWS; i++) {
                csv.append("SKU-").append(i).append(",Widget,100,EUR,true\n");
            }
            assertThat(rejectionOf(csv.toString()).code()).isEqualTo("too_many_rows");
        }

        @Test
        void rejectsARowWithTheWrongNumberOfColumns() {
            CsvRejectedException rejection = rejectionOf(HEADER + "WIDGET-1,Small widget,1250\n");

            assertThat(rejection.code()).isEqualTo("csv_validation_failed");
            assertThat(rejection.errors()).singleElement()
                    .returns("column_count_mismatch", RowError::code);
        }
    }

    @Nested
    @DisplayName("row validation")
    class RowValidation {

        @ParameterizedTest(name = "[{index}] {2} on line 2")
        @CsvSource({
                "',Small widget,1250,EUR,true',            sku,         required",
                "'wid get,Small widget,1250,EUR,true',     sku,         invalid_format",
                "'WIDGET-1,,1250,EUR,true',                name,        required",
                "'WIDGET-1,Small widget,,EUR,true',        price_cents, required",
                "'WIDGET-1,Small widget,12.50,EUR,true',   price_cents, not_an_integer",
                "'WIDGET-1,Small widget,-1,EUR,true',      price_cents, out_of_range",
                "'WIDGET-1,Small widget,1250,,true',       currency,    required",
                "'WIDGET-1,Small widget,1250,XYZ,true',    currency,    unknown_currency",
                "'WIDGET-1,Small widget,1250,EUR,maybe',   active,      not_a_boolean",
        })
        void rejectsTheFileAndNamesTheOffendingFieldAndLine(String row, String field, String code) {
            CsvRejectedException rejection = rejectionOf(HEADER + row + "\n");

            assertThat(rejection.code()).isEqualTo("csv_validation_failed");
            assertThat(rejection.errors()).singleElement()
                    .returns(2L, RowError::line)
                    .returns(field, RowError::field)
                    .returns(code, RowError::code);
        }

        @Test
        void rejectsTheWholeFileWhenASingleRowIsInvalid() {
            CsvRejectedException rejection = rejectionOf(HEADER + """
                    WIDGET-1,Small widget,1250,EUR,true
                    WIDGET-2,Large widget,-5,EUR,true
                    WIDGET-3,Huge widget,9900,EUR,true
                    """);

            assertThat(rejection.errors()).singleElement().returns(3L, RowError::line);
        }

        @Test
        void rejectsASkuThatRepeatsWithinTheFileAndNamesBothLines() {
            CsvRejectedException rejection = rejectionOf(HEADER + """
                    WIDGET-1,Small widget,1250,EUR,true
                    WIDGET-1,Small widget again,1300,EUR,true
                    """);

            assertThat(rejection.errors()).singleElement()
                    .returns(3L, RowError::line)
                    .returns("duplicate_in_file", RowError::code);
            assertThat(rejection.errors().get(0).message()).contains("line 2");
        }

        @Test
        void reportsEveryProblemInARowRatherThanOnlyTheFirst() {
            CsvRejectedException rejection = rejectionOf(HEADER + ",,,,\n");

            assertThat(rejection.errors())
                    .extracting(RowError::field)
                    .containsExactly("sku", "name", "price_cents", "currency");
        }

        @Test
        void countsAllErrorsButReportsAtMostTheCap() {
            StringBuilder csv = new StringBuilder(HEADER);
            int badRows = ProductCsvParser.MAX_REPORTED_ERRORS + 25;
            for (int i = 0; i < badRows; i++) {
                csv.append("SKU-").append(i).append(",Widget,nope,EUR,true\n");
            }

            CsvRejectedException rejection = rejectionOf(csv.toString());

            assertThat(rejection.totalErrorCount()).isEqualTo(badRows);
            assertThat(rejection.errors()).hasSize(ProductCsvParser.MAX_REPORTED_ERRORS);
        }
    }
}
