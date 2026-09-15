package com.example.orders.idempotency;

import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The ledger is unbounded otherwise: one row per order, forever.
 *
 * <p>Retention must be comfortably longer than the longest plausible client retry
 * window (mobile clients can hold a queued request across an app restart). 30 days is
 * generous; the cost is a narrow row per request.
 *
 * <p>After expiry a replayed key would execute again — which is why retention is a
 * documented part of the API contract, not an implementation detail.
 */
@Component
public class IdempotencyCleanupJob {

    private static final Logger log = LoggerFactory.getLogger(IdempotencyCleanupJob.class);
    private static final Duration RETENTION = Duration.ofDays(30);

    private final IdempotencyRepository repository;

    public IdempotencyCleanupJob(IdempotencyRepository repository) {
        this.repository = repository;
    }

    @Scheduled(cron = "0 30 3 * * *")
    public void purgeExpiredKeys() {
        int deleted = repository.deleteOlderThan(RETENTION);
        log.info("purged {} idempotency keys older than {}", deleted, RETENTION);
    }
}
