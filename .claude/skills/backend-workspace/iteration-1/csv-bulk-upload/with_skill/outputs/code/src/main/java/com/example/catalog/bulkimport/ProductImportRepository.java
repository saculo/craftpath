package com.example.catalog.bulkimport;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * All SQL for the bulk import lives here. Note what is <em>absent</em>: there is
 * no "does this sku already exist" query. A pre-check would race with a
 * concurrent import; the unique constraint does not.
 */
@Repository
public class ProductImportRepository {

    /** Rows per JDBC batch. Large enough to amortise round trips, small enough to bound memory. */
    private static final int BATCH_SIZE = 1_000;

    private final JdbcTemplate jdbc;

    public ProductImportRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<ImportRecord> findByIdempotencyKey(String key) {
        List<ImportRecord> found = jdbc.query(
                """
                SELECT id, idempotency_key, file_sha256, row_count, inserted_count
                FROM product_import
                WHERE idempotency_key = ?
                """,
                (rs, rowNum) -> new ImportRecord(
                        rs.getObject("id", UUID.class),
                        rs.getString("idempotency_key"),
                        rs.getString("file_sha256"),
                        rs.getInt("row_count"),
                        rs.getInt("inserted_count")),
                key);
        return found.stream().findFirst();
    }

    public void insertImport(ImportRecord record) {
        jdbc.update(
                """
                INSERT INTO product_import (id, idempotency_key, file_sha256, row_count, inserted_count)
                VALUES (?, ?, ?, ?, ?)
                """,
                record.id(), record.idempotencyKey(), record.fileSha256(),
                record.rowCount(), record.insertedCount());
    }

    /**
     * Inserts every row in batches. A constraint violation anywhere in any batch
     * aborts the surrounding transaction, which is exactly the all-or-nothing
     * behaviour the endpoint promises.
     */
    public void insertProducts(UUID importId, List<ProductRow> rows) {
        String sql = """
                INSERT INTO product (sku, name, price_cents, currency, active, import_id)
                VALUES (?, ?, ?, ?, ?, ?)
                """;
        for (int start = 0; start < rows.size(); start += BATCH_SIZE) {
            List<ProductRow> chunk = rows.subList(start, Math.min(start + BATCH_SIZE, rows.size()));
            jdbc.batchUpdate(sql, chunk, chunk.size(), (ps, row) -> {
                ps.setString(1, row.sku());
                ps.setString(2, row.name());
                ps.setLong(3, row.priceCents());
                ps.setString(4, row.currency());
                ps.setBoolean(5, row.active());
                ps.setObject(6, importId);
            });
        }
    }

    public record ImportRecord(
            UUID id,
            String idempotencyKey,
            String fileSha256,
            int rowCount,
            int insertedCount) {
    }
}
