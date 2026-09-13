package com.example.avatar;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.testcontainers.containers.MinIOContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.BucketVersioningStatus;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;
import software.amazon.awssdk.services.s3.model.DeleteMarkerEntry;
import software.amazon.awssdk.services.s3.model.ListObjectVersionsRequest;
import software.amazon.awssdk.services.s3.model.ListObjectVersionsResponse;
import software.amazon.awssdk.services.s3.model.ObjectVersion;
import software.amazon.awssdk.services.s3.model.PutBucketVersioningRequest;
import software.amazon.awssdk.services.s3.model.VersioningConfiguration;

import java.net.URI;

/**
 * Proves the acceptance criterion:
 *
 * <pre>unsupported formats return 415 before any storage write</pre>
 *
 * <p>The criterion has two halves and both are asserted against real boundaries:
 *
 * <ol>
 *   <li>the response status is 415 Unsupported Media Type;
 *   <li>nothing reached storage — not the object store, not the metadata table.
 * </ol>
 *
 * <p>The second half is why this is an integration test rather than a unit test with a mocked
 * {@code BlobStore}: a mock would encode the exact assumption under question. The bucket is created
 * with versioning enabled, so an object that was written and then deleted still leaves a noncurrent
 * version plus a delete marker behind. That distinguishes "never written" (the criterion) from
 * "written, then cleaned up on the error path" (a criterion violation that a plain object listing
 * would report as success).
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class AvatarUploadIT {

    private static final String BUCKET = "avatars";
    private static final String ACCESS_KEY = "test-access-key";
    private static final String SECRET_KEY = "test-secret-key";

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"));

    @Container
    static final MinIOContainer MINIO =
            new MinIOContainer(DockerImageName.parse("minio/minio:RELEASE.2024-06-13T22-53-53Z"))
                    .withUserName(ACCESS_KEY)
                    .withPassword(SECRET_KEY);

    @DynamicPropertySource
    static void applicationProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("storage.s3.endpoint", MINIO::getS3URL);
        registry.add("storage.s3.access-key", () -> ACCESS_KEY);
        registry.add("storage.s3.secret-key", () -> SECRET_KEY);
        registry.add("storage.s3.bucket", () -> BUCKET);
    }

    @Autowired private TestRestTemplate http;
    @Autowired private DataSource dataSource;

    private S3Client s3;
    private JdbcTemplate jdbc;

    @BeforeEach
    void resetStorage() {
        s3 =
                S3Client.builder()
                        .endpointOverride(URI.create(MINIO.getS3URL()))
                        .region(Region.US_EAST_1)
                        .forcePathStyle(true)
                        .credentialsProvider(
                                StaticCredentialsProvider.create(
                                        AwsBasicCredentials.create(ACCESS_KEY, SECRET_KEY)))
                        .build();
        jdbc = new JdbcTemplate(dataSource);

        deleteBucketIfPresent();
        s3.createBucket(CreateBucketRequest.builder().bucket(BUCKET).build());
        s3.putBucketVersioning(
                PutBucketVersioningRequest.builder()
                        .bucket(BUCKET)
                        .versioningConfiguration(
                                VersioningConfiguration.builder()
                                        .status(BucketVersioningStatus.ENABLED)
                                        .build())
                        .build());

        jdbc.update("DELETE FROM avatars");
    }

    @Test
    void rejectsUnsupportedFormatBeforeWriting() {
        ResponseEntity<String> response = upload("payload.tiff", "image/tiff", tiffBytes());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE);

        ListObjectVersionsResponse versions =
                s3.listObjectVersions(ListObjectVersionsRequest.builder().bucket(BUCKET).build());
        assertThat(versions.versions())
                .describedAs("object versions in %s after a rejected upload", BUCKET)
                .extracting(ObjectVersion::key)
                .isEmpty();
        assertThat(versions.deleteMarkers())
                .describedAs(
                        "delete markers in %s — a marker means the upload was written and then"
                                + " deleted, so the rejection did not happen before the write",
                        BUCKET)
                .extracting(DeleteMarkerEntry::key)
                .isEmpty();

        Integer metadataRows =
                jdbc.queryForObject("SELECT count(*) FROM avatars", Integer.class);
        assertThat(metadataRows).describedAs("rows in avatars after a rejected upload").isZero();
    }

    /**
     * Control case. Without it, {@link #rejectsUnsupportedFormatBeforeWriting} would still pass if
     * the upload endpoint never wrote to this bucket at all — a test that cannot fail. This one
     * fails if the storage assertions above are pointed at the wrong bucket, the wrong table, or a
     * storage backend the application is not actually using.
     */
    @Test
    void storesSupportedFormat() {
        ResponseEntity<String> response = upload("payload.png", "image/png", pngBytes());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);

        ListObjectVersionsResponse versions =
                s3.listObjectVersions(ListObjectVersionsRequest.builder().bucket(BUCKET).build());
        assertThat(versions.versions()).hasSize(1);

        Integer metadataRows =
                jdbc.queryForObject("SELECT count(*) FROM avatars", Integer.class);
        assertThat(metadataRows).isEqualTo(1);
    }

    private ResponseEntity<String> upload(String filename, String contentType, byte[] content) {
        ByteArrayResource file =
                new ByteArrayResource(content) {
                    @Override
                    public String getFilename() {
                        return filename;
                    }
                };

        HttpHeaders partHeaders = new HttpHeaders();
        partHeaders.setContentType(MediaType.parseMediaType(contentType));

        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("file", new HttpEntity<>(file, partHeaders));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);

        return http.postForEntity("/avatars", new HttpEntity<>(body, headers), String.class);
    }

    /** A real TIFF magic number, so rejection is on format rather than on unreadable bytes. */
    private static byte[] tiffBytes() {
        return new byte[] {'I', 'I', 42, 0, 8, 0, 0, 0};
    }

    private static byte[] pngBytes() {
        return ("PNG\r\n\n").getBytes(StandardCharsets.ISO_8859_1);
    }

    private void deleteBucketIfPresent() {
        try {
            ListObjectVersionsResponse versions =
                    s3.listObjectVersions(
                            ListObjectVersionsRequest.builder().bucket(BUCKET).build());
            List<software.amazon.awssdk.services.s3.model.ObjectIdentifier> doomed =
                    java.util.stream.Stream.concat(
                                    versions.versions().stream()
                                            .map(
                                                    v ->
                                                            software.amazon.awssdk.services.s3.model
                                                                    .ObjectIdentifier.builder()
                                                                    .key(v.key())
                                                                    .versionId(v.versionId())
                                                                    .build()),
                                    versions.deleteMarkers().stream()
                                            .map(
                                                    m ->
                                                            software.amazon.awssdk.services.s3.model
                                                                    .ObjectIdentifier.builder()
                                                                    .key(m.key())
                                                                    .versionId(m.versionId())
                                                                    .build()))
                            .toList();
            for (var id : doomed) {
                s3.deleteObject(
                        b -> b.bucket(BUCKET).key(id.key()).versionId(id.versionId()));
            }
            s3.deleteBucket(b -> b.bucket(BUCKET));
        } catch (software.amazon.awssdk.services.s3.model.NoSuchBucketException expected) {
            // First run against a fresh container: nothing to clean.
        }
    }
}
