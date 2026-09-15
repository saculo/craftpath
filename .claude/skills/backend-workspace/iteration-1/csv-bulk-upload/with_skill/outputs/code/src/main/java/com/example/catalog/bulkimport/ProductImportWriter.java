package com.example.catalog.bulkimport;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Owns the transaction, and nothing else.
 *
 * <p>It is a separate bean from {@link ProductBulkImportService} so the transaction
 * boundary is visible and starts as late as possible: parsing, validating and
 * hashing a 10 MB file all happen before this method is entered, so no database
 * connection is held while they run.
 */
@Component
public class ProductImportWriter {

    private final ProductImportRepository repository;

    public ProductImportWriter(ProductImportRepository repository) {
        this.repository = repository;
    }

    /**
     * Writes the import record and every product atomically.
     *
     * @throws ImportConflictException if a sku already exists, or the idempotency key
     *                                 was claimed concurrently. The transaction is
     *                                 rolled back in both cases, so nothing is written.
     */
    @Transactional
    public ProductImportRepository.ImportRecord write(
            UUID importId, String idempotencyKey, String fileSha256, List<ProductRow> rows) {

        var record = new ProductImportRepository.ImportRecord(
                importId, idempotencyKey, fileSha256, rows.size(), rows.size());
        try {
            // Intent first, then the work, so a committed import row always implies
            // its products are present.
            repository.insertImport(record);
            repository.insertProducts(importId, rows);
            return record;
        } catch (DuplicateKeyException e) {
            throw translate(e);
        }
    }

    private ImportConflictException translate(DuplicateKeyException e) {
        String detail = String.valueOf(e.getMostSpecificCause().getMessage());
        if (detail.contains("product_import_idempotency_key_key")) {
            // Two identical requests raced. The winner's result is authoritative;
            // the caller is told to read it back rather than shown a 500.
            return new ImportConflictException(
                    "idempotency_key_in_progress",
                    "An import with this Idempotency-Key is already being processed.");
        }
        return new ImportConflictException(
                "sku_already_exists",
                "One or more skus in the file already exist. No products were imported.");
    }
}
