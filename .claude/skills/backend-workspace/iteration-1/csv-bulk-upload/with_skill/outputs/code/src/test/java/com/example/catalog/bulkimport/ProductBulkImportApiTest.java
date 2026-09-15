package com.example.catalog.bulkimport;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * End-to-end tests against a real PostgreSQL, because the guarantees under test —
 * atomic rollback, the unique constraint, the idempotency key — are properties of
 * the database, and an in-memory substitute would prove nothing about them.
 *
 * <p>Every rejection test asserts both halves: the status the caller sees, and that
 * the table is unchanged.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
@WithMockUser(authorities = "catalog:write")
class ProductBulkImportApiTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    private static final String HEADER = "sku,name,price_cents,currency,active\n";
    private static final String VALID_CSV = HEADER + """
            WIDGET-1,Small widget,1250,EUR,true
            WIDGET-2,Large widget,9900,EUR,false
            WIDGET-3,Huge widget,19900,EUR,true
            """;

    @Autowired
    MockMvc mockMvc;

    @Autowired
    JdbcTemplate jdbc;

    @MockitoSpyBean
    ProductImportRepository repository;

    @BeforeEach
    void resetCatalog() {
        jdbc.update("DELETE FROM product");
        jdbc.update("DELETE FROM product_import");
    }

    // --- happy path ---------------------------------------------------------

    @Test
    void importsEveryRowAndReportsTheCount() throws Exception {
        MvcResult result = upload(VALID_CSV, "key-1")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.insertedCount").value(3))
                .andExpect(jsonPath("$.replayed").value(false))
                .andReturn();

        assertThat(productCount()).isEqualTo(3);
        assertThat(skus()).containsExactlyInAnyOrder("WIDGET-1", "WIDGET-2", "WIDGET-3");
        assertThat(result.getResponse().getContentAsString()).doesNotContain("INSERT INTO");
    }

    @Test
    void linksEveryImportedProductToTheImportRecord() throws Exception {
        upload(VALID_CSV, "key-1").andExpect(status().isCreated());

        UUID importId = jdbc.queryForObject("SELECT id FROM product_import", UUID.class);
        Integer linked = jdbc.queryForObject(
                "SELECT count(*) FROM product WHERE import_id = ?", Integer.class, importId);
        assertThat(linked).isEqualTo(3);
    }

    // --- whole-file rejection, and nothing written ---------------------------

    @Test
    @DisplayName("one invalid row rejects the file and writes nothing")
    void rejectsTheWholeFileWhenOneRowIsInvalidAndWritesNothing() throws Exception {
        String csv = HEADER + """
                WIDGET-1,Small widget,1250,EUR,true
                WIDGET-2,Large widget,-5,EUR,true
                WIDGET-3,Huge widget,19900,EUR,true
                """;

        upload(csv, "key-1")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("csv_validation_failed"))
                .andExpect(jsonPath("$.errors[0].line").value(3))
                .andExpect(jsonPath("$.errors[0].field").value("price_cents"));

        assertThat(productCount()).isZero();
        assertThat(importCount()).isZero();
    }

    @Test
    void leavesProductsFromEarlierImportsUntouchedWhenAFileIsRejected() throws Exception {
        upload(VALID_CSV, "key-1").andExpect(status().isCreated());

        upload(HEADER + "OTHER-1,Other,notanumber,EUR,true\n", "key-2")
                .andExpect(status().isBadRequest());

        assertThat(skus()).containsExactlyInAnyOrder("WIDGET-1", "WIDGET-2", "WIDGET-3");
    }

    @Test
    void rejectsTheFileWhenASkuAlreadyExistsAndWritesNothing() throws Exception {
        upload(VALID_CSV, "key-1").andExpect(status().isCreated());

        String overlapping = HEADER + """
                NEW-1,Brand new,500,EUR,true
                WIDGET-2,Duplicate of an existing product,600,EUR,true
                """;
        upload(overlapping, "key-2")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("sku_already_exists"));

        // The valid row that shared the file was rolled back with the rest.
        assertThat(skus()).doesNotContain("NEW-1").hasSize(3);
        assertThat(importCount()).isEqualTo(1);
    }

    @Test
    void rejectsAFileWithAWrongHeaderAndWritesNothing() throws Exception {
        upload("sku,name,price\nWIDGET-1,Small widget,1250\n", "key-1")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_header"));

        assertThat(productCount()).isZero();
    }

    @Test
    void rejectsARequestWithoutAnIdempotencyKeyAndWritesNothing() throws Exception {
        mockMvc.perform(multipart("/api/v1/products/bulk-import").file(csvPart(VALID_CSV)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("missing_idempotency_key"));

        assertThat(productCount()).isZero();
    }

    @Test
    void rejectsANonCsvUploadAndWritesNothing() throws Exception {
        MockMultipartFile part = new MockMultipartFile(
                "file", "products.png", MediaType.IMAGE_PNG_VALUE, new byte[]{1, 2, 3});

        mockMvc.perform(multipart("/api/v1/products/bulk-import")
                        .file(part)
                        .header("Idempotency-Key", "key-1"))
                .andExpect(status().isUnsupportedMediaType());

        assertThat(productCount()).isZero();
    }

    @Test
    void neverOpensATransactionWhenTheFileIsInvalid() throws Exception {
        upload(HEADER + "WIDGET-1,Small widget,-5,EUR,true\n", "key-1")
                .andExpect(status().isBadRequest());

        // Validation precedes every database interaction, including the replay lookup.
        org.mockito.Mockito.verifyNoInteractions(repository);
    }

    // --- retries ------------------------------------------------------------

    @Test
    void treatsARepeatOfTheSameUploadUnderTheSameKeyAsANoOp() throws Exception {
        MvcResult first = upload(VALID_CSV, "key-1").andExpect(status().isCreated()).andReturn();

        upload(VALID_CSV, "key-1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.replayed").value(true))
                .andExpect(jsonPath("$.importId").value(importIdOf(first)));

        assertThat(productCount()).isEqualTo(3);
    }

    @Test
    void rejectsADifferentFileSentUnderAnAlreadyUsedKey() throws Exception {
        upload(VALID_CSV, "key-1").andExpect(status().isCreated());

        upload(HEADER + "OTHER-1,Other,500,EUR,true\n", "key-1")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("idempotency_key_reused"));

        assertThat(skus()).doesNotContain("OTHER-1");
    }

    @Test
    void importsOnlyOnceWhenTheSameUploadArrivesTwiceConcurrently() throws Exception {
        Callable<Integer> upload = () -> upload(VALID_CSV, "key-1").andReturn()
                .getResponse().getStatus();

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            List<Future<Integer>> results = pool.invokeAll(List.of(upload, upload));
            List<Integer> statuses = List.of(results.get(0).get(), results.get(1).get());

            // One creates; the other either replays (200) or loses the race on the
            // unique key (409). Never two imports, and never a 500.
            assertThat(statuses).contains(201).allSatisfy(s -> assertThat(s).isIn(200, 201, 409));
        } finally {
            pool.shutdownNow();
        }
        assertThat(productCount()).isEqualTo(3);
        assertThat(importCount()).isEqualTo(1);
    }

    // --- helpers ------------------------------------------------------------

    private org.springframework.test.web.servlet.ResultActions upload(String csv, String key) throws Exception {
        return mockMvc.perform(multipart("/api/v1/products/bulk-import")
                .file(csvPart(csv))
                .header("Idempotency-Key", key));
    }

    private static MockMultipartFile csvPart(String csv) {
        return new MockMultipartFile(
                "file", "products.csv", "text/csv", csv.getBytes(StandardCharsets.UTF_8));
    }

    private static String importIdOf(MvcResult result) throws Exception {
        return com.jayway.jsonpath.JsonPath.read(result.getResponse().getContentAsString(), "$.importId");
    }

    private int productCount() {
        return jdbc.queryForObject("SELECT count(*) FROM product", Integer.class);
    }

    private int importCount() {
        return jdbc.queryForObject("SELECT count(*) FROM product_import", Integer.class);
    }

    private List<String> skus() {
        return jdbc.queryForList("SELECT sku FROM product", String.class);
    }
}
