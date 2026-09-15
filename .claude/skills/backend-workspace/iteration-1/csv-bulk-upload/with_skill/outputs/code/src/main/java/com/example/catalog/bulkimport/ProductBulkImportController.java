package com.example.catalog.bulkimport;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Locale;
import java.util.Set;

/**
 * <h2>POST /api/v1/products/bulk-import</h2>
 *
 * <p>{@code multipart/form-data} with one part, {@code file}, holding a UTF-8 CSV
 * whose header is exactly {@code sku,name,price_cents,currency,active}.
 * {@code Idempotency-Key} is required.
 *
 * <table>
 *   <tr><td>201 Created</td><td>every row imported; body is an {@link ImportSummary}</td></tr>
 *   <tr><td>200 OK</td><td>same key and same file seen before; nothing written this time</td></tr>
 *   <tr><td>400 Bad Request</td><td>missing part or key, bad header, or any invalid row</td></tr>
 *   <tr><td>409 Conflict</td><td>a sku already exists, or the key was reused for another file</td></tr>
 *   <tr><td>413 Payload Too Large</td><td>file exceeds the configured limit</td></tr>
 *   <tr><td>415 Unsupported Media Type</td><td>the part is not a CSV</td></tr>
 * </table>
 *
 * <p>On every non-2xx response, nothing has been written.
 */
@RestController
@RequestMapping("/api/v1/products")
public class ProductBulkImportController {

    private static final Logger log = LoggerFactory.getLogger(ProductBulkImportController.class);

    private static final Set<String> ACCEPTED_TYPES =
            Set.of("text/csv", "application/csv", "text/plain", "application/vnd.ms-excel");
    private static final int MAX_IDEMPOTENCY_KEY_LENGTH = 200;

    private final ProductBulkImportService service;

    public ProductBulkImportController(ProductBulkImportService service) {
        this.service = service;
    }

    @PostMapping(path = "/bulk-import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('catalog:write')")
    public ResponseEntity<ImportSummary> bulkImport(
            @RequestPart("file") MultipartFile file,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {

        requireIdempotencyKey(idempotencyKey);
        requireCsv(file);

        byte[] content = read(file);
        ImportSummary summary = service.importCsv(idempotencyKey, content);

        log.info("bulk import request completed: importId={} rows={} replayed={} bytes={}",
                summary.importId(), summary.rowCount(), summary.replayed(), content.length);

        return ResponseEntity
                .status(summary.replayed() ? HttpStatus.OK : HttpStatus.CREATED)
                .body(summary);
    }

    private static void requireIdempotencyKey(String key) {
        if (key == null || key.isBlank()) {
            throw CsvRejectedException.file("missing_idempotency_key",
                    "An Idempotency-Key header is required so a retried upload cannot import twice.");
        }
        if (key.length() > MAX_IDEMPOTENCY_KEY_LENGTH) {
            throw CsvRejectedException.file("invalid_idempotency_key",
                    "Idempotency-Key must be at most " + MAX_IDEMPOTENCY_KEY_LENGTH + " characters.");
        }
    }

    private static void requireCsv(MultipartFile file) {
        if (file.isEmpty()) {
            throw CsvRejectedException.file("empty_file", "The uploaded file is empty.");
        }
        String contentType = file.getContentType();
        if (contentType != null) {
            String base = contentType.split(";")[0].trim().toLowerCase(Locale.ROOT);
            if (!ACCEPTED_TYPES.contains(base)) {
                // Logged as a decision, with the offending value, because this is the
                // single most common cause of a confused caller.
                log.info("rejected upload: unsupported content type {}", base);
                throw CsvRejectedException.file("unsupported_media_type",
                        "Expected a CSV file; received " + base + ".");
            }
        }
    }

    private static byte[] read(MultipartFile file) {
        try {
            return file.getBytes();
        } catch (IOException e) {
            // Truncated or aborted upload: the caller's problem to retry, not a 500.
            log.warn("upload could not be read", e);
            throw CsvRejectedException.file("upload_unreadable",
                    "The upload could not be read; please retry.");
        }
    }
}
