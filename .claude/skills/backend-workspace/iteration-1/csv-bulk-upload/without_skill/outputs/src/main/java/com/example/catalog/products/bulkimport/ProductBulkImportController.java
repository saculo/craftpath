package com.example.catalog.products.bulkimport;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.example.catalog.products.bulkimport.BulkImportErrors.MalformedCsvException;
import com.example.catalog.products.bulkimport.ProductBulkImportService.ImportSummary;

@RestController
@RequestMapping("/api/v1/products")
public class ProductBulkImportController {

    private static final Logger log = LoggerFactory.getLogger(ProductBulkImportController.class);

    private final ProductBulkImportService service;

    public ProductBulkImportController(ProductBulkImportService service) {
        this.service = service;
    }

    /**
     * Bulk-creates products from a CSV upload. All-or-nothing: if any row is invalid the file is
     * rejected with a per-line error list and nothing is written.
     *
     * <p>Requires a dedicated role. Bulk import is a far bigger lever than single-product create
     * and should not inherit that permission by accident.
     */
    @PostMapping(path = "/bulk-import",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @PreAuthorize("hasRole('CATALOG_WRITE')")
    public ResponseEntity<ImportSummary> bulkImport(
            @RequestParam("file") MultipartFile file,
            // Reserved now so adding replay protection later is not a breaking API change.
            // TODO: look the key up in an idempotency store and return the stored summary on a
            // repeat, once key retention has been decided.
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey) {

        if (file.isEmpty()) {
            throw new MalformedCsvException("empty_file", "Uploaded file is empty.");
        }

        log.info("Bulk import received. filename={} bytes={}",
                sanitize(file.getOriginalFilename()), file.getSize());

        try (InputStream csv = file.getInputStream()) {
            return ResponseEntity.ok(service.importCsv(csv));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Filenames are attacker-controlled; keep CR/LF out of the log line. */
    private static String sanitize(String filename) {
        return filename == null ? "<none>" : filename.replaceAll("[\\r\\n]", "_");
    }
}
