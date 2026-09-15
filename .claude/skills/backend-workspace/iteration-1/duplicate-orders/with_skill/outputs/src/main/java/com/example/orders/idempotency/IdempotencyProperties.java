package com.example.orders.idempotency;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param retention     how long a key stays replayable. Must comfortably exceed
 *                      the longest retry window any client uses, including a
 *                      mobile client that retries after the user reopens the app.
 * @param requireKey    when false the endpoint still accepts keyless requests and
 *                      only logs them. Used during the rollout window while old
 *                      mobile builds are still in the wild.
 * @param reaperBatch   rows deleted per reaper pass, to keep the delete short and
 *                      out of the way of request traffic.
 */
@ConfigurationProperties("orders.idempotency")
public record IdempotencyProperties(
        Duration retention,
        boolean requireKey,
        int reaperBatch) {

    public IdempotencyProperties {
        if (retention == null) {
            retention = Duration.ofHours(72);
        }
        if (reaperBatch <= 0) {
            reaperBatch = 5_000;
        }
    }
}
