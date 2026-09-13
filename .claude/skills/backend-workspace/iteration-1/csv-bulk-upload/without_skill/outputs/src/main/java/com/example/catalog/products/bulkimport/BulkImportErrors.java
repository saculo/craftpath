package com.example.catalog.products.bulkimport;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

/**
 * Exceptions for the bulk import path and their HTTP mapping.
 *
 * <p>The status codes carry meaning that the caller acts on differently:
 * <ul>
 *   <li>{@code 400} — the upload isn't a product CSV (bad header, ragged row, too large).
 *       Retrying the same bytes cannot help.
 *   <li>{@code 422} — it is a product CSV, but the data is wrong. The response lists what to fix.
 *   <li>{@code 409} — the data was fine but lost a race. Retrying unchanged may well succeed.
 * </ul>
 * In every case nothing was written.
 */
public final class BulkImportErrors {

    private BulkImportErrors() {
    }

    /** The file is not a well-formed product CSV. Fail-fast; no per-row detail to give. */
    public static class MalformedCsvException extends RuntimeException {
        private final String code;

        public MalformedCsvException(String code, String message) {
            super(message);
            this.code = code;
        }

        public String code() {
            return code;
        }
    }

    /** The file parsed, but one or more rows are invalid, so the whole file is rejected. */
    public static class CsvValidationException extends RuntimeException {
        private final transient List<RowError> errors;
        private final int totalRows;

        public CsvValidationException(List<RowError> errors, int totalRows) {
            super("File rejected: " + errors.size() + " invalid row(s).");
            this.errors = List.copyOf(errors);
            this.totalRows = totalRows;
        }

        public List<RowError> errors() {
            return errors;
        }

        public int totalRows() {
            return totalRows;
        }
    }

    /** A SKU was taken by a concurrent writer between validation and commit. */
    public static class SkuConflictException extends RuntimeException {
        public SkuConflictException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public record ErrorResponse(
            String code,
            String message,
            Integer rowCount,
            Integer errorCount,
            Boolean errorsTruncated,
            List<RowError> errors) {

        static ErrorResponse simple(String code, String message) {
            return new ErrorResponse(code, message, null, null, null, null);
        }
    }

    @RestControllerAdvice
    public static class Handler {

        private static final Logger log = LoggerFactory.getLogger(Handler.class);

        @ExceptionHandler(CsvValidationException.class)
        public ResponseEntity<ErrorResponse> onValidation(CsvValidationException e) {
            List<RowError> all = e.errors();
            boolean truncated = all.size() > ProductCsvParser.MAX_REPORTED_ERRORS;
            List<RowError> reported = truncated
                    ? all.subList(0, ProductCsvParser.MAX_REPORTED_ERRORS)
                    : all;

            // Count only: row contents are product data and do not belong in application logs.
            log.info("Bulk import rejected. rows={} errors={}", e.totalRows(), all.size());

            return ResponseEntity.unprocessableEntity().body(new ErrorResponse(
                    "csv_validation_failed",
                    "File rejected; no products were written.",
                    e.totalRows(),
                    all.size(),
                    truncated,
                    reported));
        }

        @ExceptionHandler(MalformedCsvException.class)
        public ResponseEntity<ErrorResponse> onMalformed(MalformedCsvException e) {
            log.info("Bulk import rejected as malformed. code={}", e.code());
            return ResponseEntity.badRequest()
                    .body(ErrorResponse.simple(e.code(), e.getMessage()));
        }

        @ExceptionHandler(SkuConflictException.class)
        public ResponseEntity<ErrorResponse> onConflict(SkuConflictException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(ErrorResponse.simple("sku_conflict", e.getMessage()));
        }

        @ExceptionHandler(MaxUploadSizeExceededException.class)
        public ResponseEntity<ErrorResponse> onTooLarge(MaxUploadSizeExceededException e) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                    .body(ErrorResponse.simple("file_too_large", "Upload exceeds the maximum allowed size."));
        }
    }
}
