package com.example.catalog.products.bulkimport;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.example.catalog.products.bulkimport.BulkImportErrors.CsvValidationException;
import com.example.catalog.products.bulkimport.BulkImportErrors.SkuConflictException;

/**
 * Owns the transaction boundary for a bulk import.
 *
 * <p>Two phases, in this order and for this reason:
 *
 * <ol>
 *   <li><b>Parse and validate, outside any transaction.</b> Produces the complete error list so a
 *       bad file is fixable in one pass, and keeps client-speed-dependent work out of a write
 *       transaction that would otherwise hold locks for its duration.
 *   <li><b>Insert, inside one short transaction.</b> The transaction is what makes "nothing
 *       written" true for the failures validation cannot see — principally a SKU taken by a
 *       concurrent request after the probe and before the commit.
 * </ol>
 *
 * <p>A {@link TransactionTemplate} is used rather than {@code @Transactional} so the boundary is
 * visible at the call site and cannot be lost to self-invocation.
 */
@Service
public class ProductBulkImportService {

    private static final Logger log = LoggerFactory.getLogger(ProductBulkImportService.class);

    private final ProductCsvParser parser;
    private final ProductBulkImportRepository repository;
    private final TransactionTemplate transactions;

    public ProductBulkImportService(ProductCsvParser parser,
                                    ProductBulkImportRepository repository,
                                    TransactionTemplate transactions) {
        this.parser = parser;
        this.repository = repository;
        this.transactions = transactions;
    }

    public ImportSummary importCsv(InputStream csv) {
        long startedAt = System.nanoTime();

        // Phase 1 — no transaction, no writes.
        CsvParseResult parsed = parser.parse(csv);
        if (parsed.rejected()) {
            throw new CsvValidationException(parsed.errors(), parsed.totalRows());
        }

        List<RowError> conflicts = findSkusAlreadyInDatabase(parsed.rows());
        if (!conflicts.isEmpty()) {
            throw new CsvValidationException(conflicts, parsed.totalRows());
        }

        // Phase 2 — one transaction, writes only.
        int inserted;
        try {
            inserted = transactions.execute(status -> repository.insertAll(parsed.rows()));
        } catch (DuplicateKeyException e) {
            // Lost a race with a concurrent writer. The transaction rolled back, so the
            // all-or-nothing guarantee holds; the caller just needs to retry with fresh SKUs.
            log.info("Bulk import lost a SKU race; nothing written. rows={}", parsed.rows().size());
            throw new SkuConflictException(
                    "A product in this file was created by another request. Nothing was written; retry the upload.", e);
        }

        long durationMs = (System.nanoTime() - startedAt) / 1_000_000;
        log.info("Bulk import succeeded. rows={} inserted={} durationMs={}",
                parsed.totalRows(), inserted, durationMs);
        return new ImportSummary(inserted, 0, durationMs);
    }

    private List<RowError> findSkusAlreadyInDatabase(List<ProductRow> rows) {
        Set<String> existing = repository.findExistingSkus(ProductBulkImportRepository.skusOf(rows));
        if (existing.isEmpty()) {
            return List.of();
        }
        List<RowError> errors = new ArrayList<>();
        for (ProductRow row : rows) {
            if (existing.contains(row.sku())) {
                errors.add(RowError.of(row.line(), "sku", row.sku(), "already exists"));
            }
        }
        return errors;
    }

    public record ImportSummary(int inserted, int skipped, long durationMs) {
    }
}
