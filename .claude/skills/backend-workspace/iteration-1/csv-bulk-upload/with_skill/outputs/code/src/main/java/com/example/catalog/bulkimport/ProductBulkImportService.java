package com.example.catalog.bulkimport;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Orders the work so that nothing is written until the file is known to be good:
 *
 * <pre>
 *   hash -> parse and validate -> check for a replay -> [transaction: write] -> log
 * </pre>
 */
@Service
public class ProductBulkImportService {

    private static final Logger log = LoggerFactory.getLogger(ProductBulkImportService.class);

    private final ProductCsvParser parser;
    private final ProductImportRepository repository;
    private final ProductImportWriter writer;

    public ProductBulkImportService(ProductCsvParser parser,
                                    ProductImportRepository repository,
                                    ProductImportWriter writer) {
        this.parser = parser;
        this.repository = repository;
        this.writer = writer;
    }

    public ImportSummary importCsv(String idempotencyKey, byte[] content) {
        String fileSha256 = sha256(content);

        // Validation first, and in full. If this throws, no connection has been
        // taken from the pool and no row exists anywhere.
        List<ProductRow> rows = parser.parse(new ByteArrayInputStream(content));

        Optional<ProductImportRepository.ImportRecord> existing =
                repository.findByIdempotencyKey(idempotencyKey);
        if (existing.isPresent()) {
            return replay(existing.get(), fileSha256, idempotencyKey);
        }

        UUID importId = UUID.randomUUID();
        var record = writer.write(importId, idempotencyKey, fileSha256, rows);

        log.info("product bulk import committed: importId={} rows={} sha256={} idempotencyKey={}",
                record.id(), record.rowCount(), fileSha256, idempotencyKey);
        return new ImportSummary(record.id(), record.rowCount(), record.insertedCount(), false);
    }

    /**
     * A retry of the same upload returns the original outcome. A <em>different</em>
     * file under a key that was already used is a client bug, not a retry, and is
     * refused rather than silently treated as either one.
     */
    private ImportSummary replay(ProductImportRepository.ImportRecord record,
                                 String fileSha256, String idempotencyKey) {
        if (!record.fileSha256().equals(fileSha256)) {
            log.warn("rejected import: Idempotency-Key reused with a different file, key={} importId={}",
                    idempotencyKey, record.id());
            throw new ImportConflictException(
                    "idempotency_key_reused",
                    "This Idempotency-Key was already used for a different file.");
        }
        log.info("product bulk import replayed: importId={} key={}", record.id(), idempotencyKey);
        return new ImportSummary(record.id(), record.rowCount(), record.insertedCount(), true);
    }

    private static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by every JRE", e);
        }
    }
}
