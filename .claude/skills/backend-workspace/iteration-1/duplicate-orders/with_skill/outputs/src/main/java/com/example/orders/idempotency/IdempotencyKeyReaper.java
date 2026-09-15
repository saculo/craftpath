package com.example.orders.idempotency;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Deletes expired keys.
 *
 * <p>Without this the table grows forever and eventually the unique index stops
 * fitting in cache, which shows up as the create-order endpoint getting slowly
 * worse for no visible reason.
 *
 * <p>Deletes in bounded batches with a bounded number of passes so one run can
 * never turn into a long transaction holding locks against live traffic. A
 * backlog is simply picked up by the next run.
 */
@Component
public class IdempotencyKeyReaper {

    private static final Logger log = LoggerFactory.getLogger(IdempotencyKeyReaper.class);
    private static final int MAX_PASSES = 20;

    private final IdempotencyStore store;
    private final IdempotencyProperties properties;

    public IdempotencyKeyReaper(IdempotencyStore store, IdempotencyProperties properties) {
        this.store = store;
        this.properties = properties;
    }

    @Scheduled(fixedDelayString = "PT15M")
    public void reap() {
        int total = 0;
        for (int pass = 0; pass < MAX_PASSES; pass++) {
            int deleted = store.deleteExpiredBatch(properties.reaperBatch());
            total += deleted;
            if (deleted < properties.reaperBatch()) {
                break;
            }
        }
        if (total > 0) {
            log.info("reaped {} expired idempotency keys", total);
        }
    }
}
