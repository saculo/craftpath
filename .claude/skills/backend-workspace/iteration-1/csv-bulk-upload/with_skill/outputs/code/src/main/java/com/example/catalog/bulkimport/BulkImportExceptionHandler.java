package com.example.catalog.bulkimport;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

import java.util.List;

/**
 * Turns the domain's refusals into the response shape the API documents.
 *
 * <p>No handler here puts an exception message, SQL, or stack frame into a body;
 * the detail goes to the log with the request in scope, and the caller gets a code
 * it can branch on.
 */
@RestControllerAdvice(assignableTypes = ProductBulkImportController.class)
public class BulkImportExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(BulkImportExceptionHandler.class);

    /** Error response body. {@code errors} is empty for whole-file failures. */
    public record ErrorResponse(
            String code,
            String message,
            List<RowError> errors,
            long errorCount,
            boolean errorsTruncated) {

        static ErrorResponse of(String code, String message) {
            return new ErrorResponse(code, message, List.of(), 0, false);
        }
    }

    @ExceptionHandler(CsvRejectedException.class)
    public ResponseEntity<ErrorResponse> onRejected(CsvRejectedException e) {
        HttpStatus status = switch (e.code()) {
            case "unsupported_media_type" -> HttpStatus.UNSUPPORTED_MEDIA_TYPE;
            case "too_many_rows" -> HttpStatus.PAYLOAD_TOO_LARGE;
            default -> HttpStatus.BAD_REQUEST;
        };
        log.info("rejected bulk import: code={} errorCount={}", e.code(), e.totalErrorCount());
        return ResponseEntity.status(status).body(new ErrorResponse(
                e.code(),
                e.getMessage(),
                e.errors(),
                e.totalErrorCount(),
                e.totalErrorCount() > e.errors().size()));
    }

    @ExceptionHandler(ImportConflictException.class)
    public ResponseEntity<ErrorResponse> onConflict(ImportConflictException e) {
        log.info("conflicting bulk import: code={}", e.code());
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of(e.code(), e.getMessage()));
    }

    @ExceptionHandler(MissingServletRequestPartException.class)
    public ResponseEntity<ErrorResponse> onMissingPart(MissingServletRequestPartException e) {
        return ResponseEntity.badRequest().body(ErrorResponse.of(
                "missing_file_part", "A multipart part named 'file' is required."));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ErrorResponse> onTooLarge(MaxUploadSizeExceededException e) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(ErrorResponse.of(
                "file_too_large", "The uploaded file exceeds the maximum allowed size."));
    }
}
