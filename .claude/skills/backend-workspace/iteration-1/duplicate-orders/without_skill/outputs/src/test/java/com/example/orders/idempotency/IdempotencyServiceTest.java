package com.example.orders.idempotency;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.orders.api.CreateOrderRequest;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * These tests run against a real Postgres. That is not optional here: the entire
 * mechanism IS the unique index and its locking behaviour. A mocked repository would
 * test nothing but the code I already wrote.
 */
@SpringBootTest
@Testcontainers
class IdempotencyServiceTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    IdempotencyService idempotency;

    @Autowired
    JdbcClient jdbc;

    private final UUID customer = UUID.randomUUID();

    private static CreateOrderRequest sampleRequest() {
        return new CreateOrderRequest(
                List.of(new CreateOrderRequest.Line(UUID.randomUUID(), 2)),
                UUID.randomUUID());
    }

    @Test
    void firstCallExecutesTheWorkAndReturnsItsResponse() {
        var scope = new IdempotencyScope("POST /orders", customer, "key-" + UUID.randomUUID());
        var work = countingWork();

        var outcome = idempotency.execute(scope, sampleRequest(), work);

        assertThat(outcome.replayed()).isFalse();
        assertThat(outcome.response().status()).isEqualTo(201);
        assertThat(work.invocations()).isEqualTo(1);
    }

    @Test
    void repeatedCallWithSameKeyReplaysWithoutReExecuting() {
        var scope = new IdempotencyScope("POST /orders", customer, "key-" + UUID.randomUUID());
        var request = sampleRequest();
        var work = countingWork();

        var first = idempotency.execute(scope, request, work);
        var second = idempotency.execute(scope, request, work);

        assertThat(work.invocations()).isEqualTo(1);
        assertThat(second.replayed()).isTrue();
        assertThat(second.response().resourceId()).isEqualTo(first.response().resourceId());
        assertThat(second.response().bodyJson()).isEqualTo(first.response().bodyJson());
    }

    @Test
    void sameKeyWithDifferentBodyIsRejectedRatherThanSilentlyReplayed() {
        var scope = new IdempotencyScope("POST /orders", customer, "key-" + UUID.randomUUID());
        idempotency.execute(scope, sampleRequest(), countingWork());

        assertThatThrownBy(() -> idempotency.execute(scope, sampleRequest(), countingWork()))
                .isInstanceOf(IdempotencyKeyReusedException.class)
                .hasMessageContaining("different request body");
    }

    @Test
    void fieldOrderInTheRequestDoesNotAffectTheFingerprint() {
        // Guards the canonicalization: a client serializing from an unordered map
        // must not trip the 422 path.
        var scope = new IdempotencyScope("POST /orders", customer, "key-" + UUID.randomUUID());
        var request = sampleRequest();

        idempotency.execute(scope, request, countingWork());
        var replay = idempotency.execute(scope, copyOf(request), countingWork());

        assertThat(replay.replayed()).isTrue();
    }

    @Test
    void keysAreNamespacedPerCaller() {
        String sharedKey = "collision-" + UUID.randomUUID();
        var work = countingWork();

        idempotency.execute(new IdempotencyScope("POST /orders", customer, sharedKey), sampleRequest(), work);
        var other = idempotency.execute(
                new IdempotencyScope("POST /orders", UUID.randomUUID(), sharedKey), sampleRequest(), work);

        assertThat(other.replayed()).isFalse();
        assertThat(work.invocations()).isEqualTo(2);
    }

    @Test
    void concurrentRetriesOfTheSameKeyExecuteTheWorkExactlyOnce() throws Exception {
        int threads = 16;
        var scope = new IdempotencyScope("POST /orders", customer, "race-" + UUID.randomUUID());
        var request = sampleRequest();
        var work = countingWork();
        var start = new CountDownLatch(1);

        try (ExecutorService pool = Executors.newFixedThreadPool(threads)) {
            List<Future<IdempotencyService.Outcome>> results = java.util.stream.IntStream.range(0, threads)
                    .mapToObj(i -> pool.<IdempotencyService.Outcome>submit(() -> {
                        start.await(5, TimeUnit.SECONDS);
                        return idempotency.execute(scope, request, work);
                    }))
                    .toList();

            start.countDown();

            var outcomes = results.stream().map(IdempotencyServiceTest::get).toList();

            assertThat(work.invocations())
                    .as("the business operation must run exactly once across all racers")
                    .isEqualTo(1);
            assertThat(outcomes).filteredOn(o -> !o.replayed()).hasSize(1);
            assertThat(outcomes).extracting(o -> o.response().resourceId()).containsOnly(
                    outcomes.getFirst().response().resourceId());
        }

        Integer rows = jdbc.sql("SELECT count(*) FROM idempotency_key WHERE idempotency_key = ?")
                .param(scope.key()).query(Integer.class).single();
        assertThat(rows).isEqualTo(1);
    }

    @Test
    void failedWorkLeavesNoKeyBehindSoTheClientCanRetry() {
        var scope = new IdempotencyScope("POST /orders", customer, "boom-" + UUID.randomUUID());

        assertThatThrownBy(() -> idempotency.execute(scope, sampleRequest(), () -> {
            throw new IllegalStateException("payment gateway down");
        })).isInstanceOf(IllegalStateException.class);

        Integer rows = jdbc.sql("SELECT count(*) FROM idempotency_key WHERE idempotency_key = ?")
                .param(scope.key()).query(Integer.class).single();
        assertThat(rows)
                .as("a rolled-back attempt must not poison the key")
                .isZero();

        var retry = idempotency.execute(scope, sampleRequest(), countingWork());
        assertThat(retry.replayed()).isFalse();
    }

    private static CreateOrderRequest copyOf(CreateOrderRequest r) {
        return new CreateOrderRequest(List.copyOf(r.lines()), r.shippingAddressId());
    }

    private static <T> T get(Future<T> f) {
        try {
            return f.get(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            throw new AssertionError("worker failed", e);
        }
    }

    private static CountingWork countingWork() {
        return new CountingWork();
    }

    /** Counts executions of the guarded operation — the property under test. */
    private static final class CountingWork implements java.util.function.Supplier<StoredResponse> {
        private final AtomicInteger calls = new AtomicInteger();

        @Override
        public StoredResponse get() {
            calls.incrementAndGet();
            UUID orderId = UUID.randomUUID();
            return new StoredResponse(201, """
                    {"id":"%s","status":"PLACED","total":42.00}""".formatted(orderId), orderId);
        }

        int invocations() {
            return calls.get();
        }
    }
}
