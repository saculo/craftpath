package com.example.catalog.products.bulkimport;

import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ProductBulkImportRepository {

    /**
     * Chosen by convention rather than measurement; worth profiling against the real row width.
     */
    static final int BATCH_SIZE = 1_000;

    /** Keeps the {@code = ANY(?)} probe off the statement-cache-busting path for huge files. */
    private static final int PROBE_CHUNK = 1_000;

    private static final String INSERT = """
            INSERT INTO products (sku, name, description, price_minor, currency, stock, active)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """;

    private final JdbcTemplate jdbc;

    public ProductBulkImportRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Which of these SKUs already exist. Used to produce a per-line error message; the unique
     * index remains the actual guarantee, since a concurrent writer can take a SKU between this
     * probe and the commit.
     */
    public Set<String> findExistingSkus(List<String> skus) {
        Set<String> existing = new HashSet<>();
        for (int from = 0; from < skus.size(); from += PROBE_CHUNK) {
            List<String> chunk = skus.subList(from, Math.min(from + PROBE_CHUNK, skus.size()));
            existing.addAll(jdbc.queryForList(
                    "SELECT sku FROM products WHERE sku = ANY(?)",
                    String.class,
                    (Object) chunk.toArray(String[]::new)));
        }
        return existing;
    }

    /**
     * Plain INSERT, batched. Deliberately not {@code ON CONFLICT DO NOTHING} or {@code DO UPDATE}:
     * either would turn "reject the file" into "partially apply the file". A conflict here must
     * fail the transaction.
     *
     * <p>Must be called inside a transaction — see {@link ProductBulkImportService}, which owns
     * that boundary.
     */
    public int insertAll(List<ProductRow> rows) {
        int inserted = 0;
        for (int from = 0; from < rows.size(); from += BATCH_SIZE) {
            List<ProductRow> batch = rows.subList(from, Math.min(from + BATCH_SIZE, rows.size()));
            int[] counts = jdbc.batchUpdate(INSERT, new BatchPreparedStatementSetter() {
                @Override
                public void setValues(PreparedStatement ps, int i) throws SQLException {
                    ProductRow row = batch.get(i);
                    ps.setString(1, row.sku());
                    ps.setString(2, row.name());
                    ps.setString(3, row.description());
                    ps.setLong(4, row.priceMinor());
                    ps.setString(5, row.currency());
                    ps.setInt(6, row.stock());
                    ps.setBoolean(7, row.active());
                }

                @Override
                public int getBatchSize() {
                    return batch.size();
                }
            });
            for (int count : counts) {
                inserted += Math.max(count, 0);
            }
        }
        return inserted;
    }

    static List<String> skusOf(List<ProductRow> rows) {
        List<String> skus = new ArrayList<>(rows.size());
        rows.forEach(row -> skus.add(row.sku()));
        return skus;
    }
}
